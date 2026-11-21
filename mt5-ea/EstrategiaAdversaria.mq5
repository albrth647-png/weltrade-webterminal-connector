//+------------------------------------------------------------------+
//| EstrategiaAdversaria.mq5                                         |
//| EA adversario para cuenta DEMO en MT5 (Windows / GitHub Actions) |
//|                                                                  |
//| Porta la escalera del nucleo del motor (motor-senales/nucleo.js) |
//|   1 / 1R   seductora (salida sobre EMA50 + quiebre con cuerpo)   |
//|   2 / 2R   2o toque a EMA30 (entrada al toque)                   |
//|   3 / 3R   3er toque a EMA30 (entrada al toque)                  |
//|   2B/2RB   quiebre del minimo anterior, entrada en el retesteo   |
//|   3B/3RB   tercer toque + quiebre                                |
//|   la R es RESET (todo junto, igual que 1RE/2RE/3RE)              |
//|                                                                  |
//| No opera: lee velas y manda la senal a Telegram por WebRequest.  |
//| La cuenta demo solo se usa para tener el feed del broker real.   |
//+------------------------------------------------------------------+
#property version   "1.00"
#property description "Escalera del video 03 sobre la cuenta DEMO; senal a Telegram."

//--------------------------------------------------------------------
//  Configuracion: se lee de  <datos>/MQL5/Files/adv.cfg
//--------------------------------------------------------------------
string g_tgToken   = "";
string g_tgChat    = "";
string g_simbolos  = "FX Vol 20,FX Vol 40,SFX Vol 20,SFX Vol 40";
string g_tfTxt     = "M5";
int    g_velas     = 3000;
int    g_latidoMin = 15;
int    g_enviarPrecios = 0;   // 1 = enviar snapshot de precios a Telegram en cada latido

// Multi-TF: el EA procesa estas 4 temporalidades en un solo terminal
string           g_tfTxtArr[];
ENUM_TIMEFRAMES  g_tfArr[];
int              g_nTf      = 4;
ENUM_TIMEFRAMES  g_tf      = PERIOD_M5;

//--------------------------------------------------------------------
//  Parametros de la escalera: copiados de PARAMS en nucleo.js
//--------------------------------------------------------------------
int    P_emaContacto       = 30;
int    P_emaTecho          = 50;
int    P_emaFondo          = 100;
int    P_atrPeriodo        = 14;
double P_tolToqueAtr       = 0.30;
int    P_ventanaMin        = 12;
double P_cuerpoMin         = 0.50;
double P_cuerpoMinAtr      = 0.10;
int    P_caducidad         = 3;
int    P_separacionToques  = 2;
int    P_caducidadEngano   = 12;
// 3x. La alerta del toque NO sale en la vela de vuelta: exige velas de
// continuacion seguidas a favor de la tendencia (cierre del lado de la
// apertura) DESPUES de la vuelta. La entrada es el cierre de la ultima.
int    P_velasConfirmacion = 2;
int    P_caducidadRetesteo = 3;
double P_tolRetesteoAtr    = 0.30;
// Filtros anti-ruido (precio pegado a EMA30)
int    P_ventanaCruces     = 12;
// Bloqueo por chop: 3 cruces de la EMA30 en 12 velas es lateral, pero 3 es
// demasiado estricto (con ER=0.50, un tramo claramente direccional, ya se
// bloqueaba). Se exige mas de un tercio de la ventana.
int    P_minCrucesBloqueo  = 4;
int    P_ventanaER         = 10;    // ventana corta: el ER de 20 castiga el retroceso
// 0.22 medido en M3 sobre la vela del quiebre es inalcanzable: el quiebre
// llega justo despues del retroceso y esa ventana de 10 velas lleva dentro
// el retroceso, asi que el ER se hunde. Caso real bloqueado: ER=0.18 con
// cruces=0 y separaciones 1.14/2.89 (nada mas fallaba).
double P_erMinQuiebre      = 0.15;
// Una sola entrada por secuencia: si ya salio la 2 (o la 3), no se emite
// despues la 2B/3B del mismo movimiento. Ponlo en false para comparar.
bool   P_unaPorSecuencia   = true;

// Disparo de la vuelta del engano (codigo "1S", la seductora).
// false -> la seductora ORIGINAL: el precio cierra mas alla de la EMA50
//          (engaño), vuelve, y la senal es el cierre con cuerpo que rompe el
//          minimo del tramo del engano. Es el comportamiento por defecto.
// true  -> variante: la senal sale solo con cerrar de vuelta por la EMA50,
//          sin exigir la ruptura del minimo del tramo.
bool   P_enganoEnEma50     = false;
// La B de cada toque (1B, 2B, 3B) es el cierre CON CUERPO que rompe el extremo
// del impulso anterior y sigue: una entrada mas, despues de cada toque.
bool   P_bPorRuptura       = true;

//--------------------------------------------------------------------
//  Modo backtest (Strategy Tester / GitHub Actions)
//  En el tester no hay timer ni Telegram. El EA recorre las velas con
//  OnTick, escribe la senal de cada vela cerrada y las barras usadas, y
//  el analisis (SL amplio / TP 1.5R / TL) lo hace Python sobre esos CSV.
//  Asi UN pase de MT5 sirve para barrer todos los TP y TL sin repetir
//  la prueba: el camino del precio ya esta en el archivo.
//--------------------------------------------------------------------
bool   InpBacktest   = false;   // forzar modo backtest (el tester lo activa solo)
string InpBtCarpeta  = "bt";    // subcarpeta en la carpeta COMUN de MT5
bool   InpBtBarras   = true;    // exportar barras (necesario para simular SL/TP)
int    InpBtVentana  = 600;     // velas de calculo por vela cerrada (EMA100 ya converge)
bool   InpBtLog      = false;   // escribir el log completo (muy lento en backtest)

bool     g_bt = false;
int      g_btHsen = INVALID_HANDLE;
int      g_btHbar[4];
datetime g_btUltBarra[4];
int      g_btEventos = 0;

datetime g_ultimoLatido = 0;
int      g_barraActual   = -1;   // solo se loguean los bloqueos de la vela actual
int      g_tfIdx         = 0;    // temporalidad en curso (0..3), para el embudo

//--------------------------------------------------------------------
//  Embudo por temporalidad: cuantos candidatos mueren en cada puerta de
//  la vela cerrada. Se acumula y se imprime una vez por vela M3 cerrada.
//  Sin esto el log solo enseña los candidatos que llegaron a la ultima
//  puerta; el resto desaparece sin rastro.
//  En Estructura el reparto es exacto y suma lo mismo que "rompe":
//     rompe = noAlinE + blqCruz + blqER + yaLa + emi
//--------------------------------------------------------------------
struct Emb
  {
   int tocaW;      // Wonderizada: velas alineadas que tocaron la EMA30
   int noAlinW;    // Wonderizada: velas que murieron en la pila EMA
   int toqW;       // Wonderizada: toques que entraron en la escalera
   int blqW;       // Wonderizada: toque 2/3 frenado por cruces o ER
   int emiW;       // Wonderizada: toque 2/3 que salio
   int imp;        // Estructura: impulsos detectados
   int noAlinE;    // Estructura: quiebres con la pila sin alinear
   int toq;        // Estructura: toques de retroceso validos
   int rompe;      // Estructura: quiebres vistos
   int blqCruz;    // Estructura: bloqueados por cruces
   int blqER;      // Estructura: bloqueados por ER
   int yaLa;       // Estructura: suprimidos por una-por-secuencia
   int emi;        // Estructura: quiebres que salieron
  };
Emb      g_emb[4];
datetime g_embBar = 0;
datetime g_panelBar = 0;   // ultima vela M3 volcada al panel web

void EmbLog()
  {
   int nt = ArraySize(g_tfTxtArr);
   for(int k = 0; k < 4; k++)
     {
      Emb e = g_emb[k];
      if(e.tocaW + e.noAlinW + e.toqW + e.blqW + e.emiW + e.imp + e.noAlinE
         + e.toq + e.rompe + e.blqCruz + e.blqER + e.yaLa + e.emi == 0)
         continue;
      string tf = IntegerToString(k);
      if(k < nt)
         tf = g_tfTxtArr[k];
      Log("[EMBUDO] " + tf
          + " W{toca=" + IntegerToString(e.tocaW) + " noAlin=" + IntegerToString(e.noAlinW)
          + " toques=" + IntegerToString(e.toqW) + " bloquea=" + IntegerToString(e.blqW)
          + " emite=" + IntegerToString(e.emiW) + "}"
          + " E{imp=" + IntegerToString(e.imp) + " noAlin=" + IntegerToString(e.noAlinE)
          + " toques=" + IntegerToString(e.toq) + " rompe=" + IntegerToString(e.rompe)
          + " cruz=" + IntegerToString(e.blqCruz) + " ER=" + IntegerToString(e.blqER)
          + " yaLa=" + IntegerToString(e.yaLa) + " emite=" + IntegerToString(e.emi) + "}");
     }
   for(int k = 0; k < 4; k++)
      ZeroMemory(g_emb[k]);
  }

//--------------------------------------------------------------------
//  Estructuras
//--------------------------------------------------------------------
struct Toque
  {
   int    bar;
   double nivel;
   double extremo;
   double alto;
   double bajo;
  };

struct Secuencia
  {
   bool   engano;
   int    enganoBar;
   double enganoNivel;     // minimo/maximo del tramo (el "cuello")
   double enganoExtremo;   // punta del tramo: stop de la vuelta del engano
   bool   toco30;          // el retroceso en curso ya toco la EMA30
   bool   confPend;        // vuelta vista: esperando las velas de continuacion
   int    confCont;        // velas de continuacion ya cumplidas
   double confExtremo;     // punta del retroceso + confirmacion: stop del toque
   bool   enganoBloq;      // el engano quedo anulado por cerrar sobre la EMA100
   double toco30Extremo;   // punta del retroceso: stop y techo del tramo
   bool   supero;          // entre el toque anterior y este hubo extremo nuevo
   double pico;            // extremo de la pata en curso: "el maximo mas previo"
   double nivelB;          // la raya que rompe la entrada B de ese toque
   bool   bHecho;          // la B de ese toque ya se aviso
   Toque  t1, t2, t3;
   int    nT;
   int    ciclo;
   int    avisados;
   bool   emitida;      // ya se entrego una entrada en este ciclo
   bool   retesteo;
   int    retBar;
   double retNivel;
   double retExtremo;
   int    ultimaEntrada;
  };

struct Evento
  {
   int    bar;
   string lado;
   string patron;
   double precio;
   double invalida;
   double nivel;
   string tendencia;
  };

//--------------------------------------------------------------------
//  Utilidades
//--------------------------------------------------------------------
void Log(const string msg)
  {
   // en backtest cada vela escribiria 4 lineas: 86k velas x 4 TF = cientos de
   // MB de log y la prueba se va en disco. Se apaga salvo InpBtLog.
   if(g_bt && !InpBtLog)
      return;
   string linea = TimeToString(TimeGMT(), TIME_DATE|TIME_SECONDS) + " " + msg;
   Print(linea);
   int h = FileOpen("adv.log", FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if(h != INVALID_HANDLE)
     {
      FileSeek(h, 0, SEEK_END);
      FileWrite(h, linea);
      FileClose(h);
     }
  }

string Normalizar(const string s)
  {
   string o = "";
   int n = StringLen(s);
   for(int i=0; i<n; i++)
     {
      ushort ch = StringGetCharacter(s, i);
      if(ch==' ' || ch=='.' || ch=='-' || ch=='_' || ch=='/' || ch=='*')
         continue;
      if(ch>='A' && ch<='Z')
         ch = (ushort)(ch + 32);
      o = o + ShortToString(ch);
     }
   return o;
  }

// El nombre del simbolo en este broker puede no coincidir letra a letra
// con el del catalogo: se prueba exacto y, si falla, por nombre normalizado.
string ResolverSimbolo(const string pedido)
  {
   if(StringLen(pedido) == 0)
      return "";
   if(SymbolSelect(pedido, true) && SymbolInfoDouble(pedido, SYMBOL_BID) > 0)
      return pedido;
   string objetivo = Normalizar(pedido);
   int total = SymbolsTotal(false);
   for(int i=0; i<total; i++)
     {
      string s = SymbolName(i, false);
      if(Normalizar(s) == objetivo)
        {
         if(SymbolSelect(s, true))
            return s;
        }
     }
   for(int i=0; i<total; i++)
     {
      string s = SymbolName(i, false);
      if(StringFind(Normalizar(s), objetivo) >= 0)
        {
         if(SymbolSelect(s, true))
            return s;
        }
     }
   return "";
  }

string FmtPrecio(const double v)
  {
   if(!(v > 0))
      return "-";
   string s = DoubleToString(v, 5);
   int n = StringLen(s);
   while(n > 0 && StringGetCharacter(s, n-1) == '0')
     {
      s = StringSubstr(s, 0, n-1);
      n--;
     }
   if(n > 0 && StringGetCharacter(s, n-1) == '.')
      s = StringSubstr(s, 0, n-1);
   return s;
  }

// 🟢 y 🔴 sin depender de la codificacion del fuente
string Icono(const bool compra)
  {
   return ShortToString((ushort)0xD83D) + ShortToString((ushort)(compra ? 0xDFE2 : 0xDD34));
  }

string TendenciaTxt(const string t)
  {
   if(t == "ALCISTA")
      return "ALCISTA (EMA30 &gt; EMA50 &gt; EMA100)";
   if(t == "BAJISTA")
      return "BAJISTA (EMA30 &lt; EMA50 &lt; EMA100)";
   return "LATERAL (precio y EMAs no alineados)";
  }

// La R es de RESET y va pegada delante de la familia:
//   Wonderizada:  1 -> 1R, 2 -> 2R, 3 -> 3R, 2B -> 2RB, 3B -> 3RB
//   Estructura: 1E -> 1RE, 2E -> 2RE, 3E -> 3RE, 2EB -> 2REB, 3EB -> 3REB
string ConReset(const string base, const int ciclo)
  {
   if(ciclo < 1)
      return base;
   if(base == "1S")  return "1SR";
   if(base == "1B")  return "1RB";
   if(base == "2")   return "2R";
   if(base == "3")   return "3R";
   if(base == "2B")  return "2RB";
   if(base == "3B")  return "3RB";
   if(base == "1E")  return "1RE";
   if(base == "2E")  return "2RE";
   if(base == "3E")  return "3RE";
   if(base == "2EB") return "2REB";
   if(base == "3EB") return "3REB";
   return base + "R";
  }

//--------------------------------------------------------------------
//  Hora de La Habana  (UTC-5, UTC-4 en horario de verano)
//--------------------------------------------------------------------
datetime PrimerDomingo(const int anio, const int mes)
  {
   MqlDateTime s;
   ZeroMemory(s);
   s.year = anio;
   s.mon  = mes;
   s.day  = 1;
   datetime t = StructToTime(s);
   MqlDateTime c;
   TimeToStruct(t, c);
   s.day = 1 + ((7 - c.day_of_week) % 7);
   return StructToTime(s);
  }

int OffsetHabana(const datetime tUTC)
  {
   MqlDateTime c;
   TimeToStruct(tUTC, c);
   // empieza el 2o domingo de marzo a las 00:00 locales (05:00 UTC) y acaba
   // el 1er domingo de noviembre a la 01:00 local (05:00 UTC)
   datetime ini = PrimerDomingo(c.year, 3)  + 7 * 86400 + 5 * 3600;
   datetime fin = PrimerDomingo(c.year, 11) + 5 * 3600;
   return (tUTC >= ini && tUTC < fin) ? -4 : -5;
  }

string HoraHabana(const datetime tUTC)
  {
   datetime h = (datetime)((long)tUTC + (long)OffsetHabana(tUTC) * 3600);
   return TimeToString(h, TIME_DATE|TIME_MINUTES);
  }

//--------------------------------------------------------------------
//  Telegram
//--------------------------------------------------------------------
string EscJson(const string s)
  {
   string o = "";
   int n = StringLen(s);
   for(int i=0; i<n; i++)
     {
      ushort ch = StringGetCharacter(s, i);
      if(ch == '"')
         o = o + "\\\"";
      else if(ch == '\\')
         o = o + "\\\\";
      else if(ch == '\n')
         o = o + "\\n";
      else if(ch == '\r')
         continue;
      else
         o = o + ShortToString(ch);
     }
   return o;
  }

bool EnviarTelegram(const string texto)
  {
   if(g_tgToken == "" || g_tgChat == "")
     {
      Log("Telegram sin configurar (.cfg sin token/chat): no se envia");
      return false;
     }
   string url = "https://api.telegram.org/bot" + g_tgToken + "/sendMessage";
   string cuerpo = "{\"chat_id\":\"" + EscJson(g_tgChat)
                   + "\",\"text\":\"" + EscJson(texto)
                   + "\",\"parse_mode\":\"HTML\",\"disable_web_page_preview\":true}";
   char utf8[];
   // WHOLE_ARRAY: count es bytes en el array destino, no caracteres del origen;
   // con StringLen(cuerpo) se truncaba el JSON cuando el texto lleva ó/emoji/·.
   StringToCharArray(cuerpo, utf8, 0, WHOLE_ARRAY, CP_UTF8);
   int largo = ArraySize(utf8) - 1;    // sin el 0 final
   if(largo <= 0)
      return false;
   // WebRequest pide uchar[], no char[]
   uchar datos[], respuesta[];
   ArrayResize(datos, largo);
   for(int i = 0; i < largo; i++)
      datos[i] = (uchar)utf8[i];
   string cabeceras = "";
   ResetLastError();
   int code = WebRequest("POST", url, "", "", 8000, datos, largo, respuesta, cabeceras);
   if(code == 200)
     {
      Log("Telegram: enviado (" + IntegerToString(largo) + " bytes)");
      return true;
     }
   int fallo = GetLastError();
   string respTxt = "";
   if(ArraySize(respuesta) > 0)
      respTxt = CharArrayToString(respuesta, 0, WHOLE_ARRAY, CP_UTF8);
   Log(StringFormat("Telegram: FALLO http=%d error=%d -> queda en pend_*.txt | resp: %s", code, fallo, respTxt));
   // Si el mensaje queda encolado, el runner lo entrega en <=15 s: para el EA
   // cuenta como enviado. Antes se devolvia false y, con el terminal bloqueado
   // (4014 en el 100% de los envios), el contador del latido nunca sumaba y el
   // antiduplicado no se marcaba aunque la senal si llegaba a Telegram.
   return GuardarPendiente(texto);
  }

// Si MT5 no deja salir a WebRequest (error 4014: URL no autorizada), el mensaje
// se guarda en un archivo propio (uno por mensaje) y el runner del workflow lo
// manda tal cual. Un archivo por mensaje evita carreras de lectura/escritura
// y hace la entrega fiable.
int g_pendienteSeq = 0;
bool GuardarPendiente(const string texto)
  {
   g_pendienteSeq++;
   // Nombre unico: tickcount ms + contador, para que dos mensajes nunca
   // sobrescriban el mismo archivo (evita perdida de senales).
   string nombre = "pend_" + IntegerToString(GetTickCount()) + "_" + IntegerToString(g_pendienteSeq) + ".txt";
   int h = FileOpen(nombre, FILE_WRITE|FILE_TXT|FILE_UNICODE);
   if(h == INVALID_HANDLE)
     {
      Log("no puedo abrir " + nombre + " (error " + IntegerToString(GetLastError()) + ")");
      return false;
     }
   FileWrite(h, texto);
   FileClose(h);
   Log("mensaje guardado en " + nombre + " (pendiente de entrega)");
   return true;
  }

//--------------------------------------------------------------------
//  Configuracion
//--------------------------------------------------------------------
ENUM_TIMEFRAMES TfDeTexto(const string txt)
  {
   string u = txt;
   StringToUpper(u);
   if(u == "M1")  return PERIOD_M1;
   if(u == "M5")  return PERIOD_M5;
   if(u == "M15") return PERIOD_M15;
   if(u == "M30") return PERIOD_M30;
   if(u == "H1")  return PERIOD_H1;
   if(u == "H4")  return PERIOD_H4;
   if(u == "D1")  return PERIOD_D1;
   return PERIOD_M5;
  }

bool CargarCfg(const string archivo)
  {
   int h = FileOpen(archivo, FILE_READ|FILE_TXT|FILE_ANSI);
   if(h == INVALID_HANDLE)
     {
      Log("No puedo abrir MQL5/Files/" + archivo + " (error " + IntegerToString(GetLastError()) + ")");
      return false;
     }
   while(!FileIsEnding(h))
     {
      string l = FileReadString(h);
      int p = StringFind(l, "=");
      if(p <= 0)
         continue;
      string k = StringSubstr(l, 0, p);
      string v = StringSubstr(l, p + 1);
      StringTrimLeft(k);
      StringTrimRight(k);
      StringTrimLeft(v);
      StringTrimRight(v);
      if(k == "token")
         g_tgToken = v;
      else if(k == "chat")
         g_tgChat = v;
      else if(k == "simbolos")
         g_simbolos = v;
      else if(k == "velas")
         g_velas = (int)StringToInteger(v);
      else if(k == "latido")
         g_latidoMin = (int)StringToInteger(v);
      else if(k == "precios")
         g_enviarPrecios = (int)StringToInteger(v);
     }
   FileClose(h);
   return true;
  }

//--------------------------------------------------------------------
//  Indicadores (misma semilla y recursion que nucleo.js)
//--------------------------------------------------------------------
void CalcEma(const double &src[], const int periodo, double &out[])
  {
   int n = ArraySize(src);
   ArrayResize(out, n);
   ArrayInitialize(out, 0.0);
   if(n < periodo)
      return;
   double suma = 0;
   for(int i=0; i<periodo; i++)
      suma += src[i];
   out[periodo-1] = suma / periodo;
   double k = 2.0 / (periodo + 1);
   for(int i=periodo; i<n; i++)
      out[i] = src[i] * k + out[i-1] * (1 - k);
  }

void CalcAtr(const MqlRates &r[], const int periodo, double &out[])
  {
   int n = ArraySize(r);
   ArrayResize(out, n);
   ArrayInitialize(out, 0.0);
   if(n < periodo + 1)
      return;
   double tr[];
   ArrayResize(tr, n);
   for(int i=0; i<n; i++)
     {
      if(i == 0)
        {
         tr[i] = r[i].high - r[i].low;
         continue;
        }
      double pc = r[i-1].close;
      double a  = r[i].high - r[i].low;
      double b  = MathAbs(r[i].high - pc);
      double c  = MathAbs(r[i].low  - pc);
      tr[i] = MathMax(a, MathMax(b, c));
     }
   double suma = 0;
   for(int i=1; i<=periodo; i++)
      suma += tr[i];
   out[periodo] = suma / periodo;
   for(int i=periodo+1; i<n; i++)
      out[i] = (out[i-1] * (periodo - 1) + tr[i]) / periodo;
  }

string Tendencia(const double cierre, const double e30, const double e50, const double e100)
  {
   if(!(e30 > 0) || !(e50 > 0) || !(e100 > 0))
      return "LATERAL";
   if(cierre > e30 && e30 >= e50 && e50 >= e100)
      return "ALCISTA";
   if(cierre < e30 && e30 <= e50 && e50 <= e100)
      return "BAJISTA";
   return "LATERAL";
  }

// Filtros anti-ruido: cruces de la EMA30 y eficiencia del movimiento
int CrucesEma30(const MqlRates &r[], const double &e30[], const int i, const int ventana)
  {
   int ini = i - ventana + 1;
   if(ini < 0)
      ini = 0;
   int cruces = 0;
   int ladoAnt = 0;
   for(int k = ini; k <= i; k++)
     {
      int lado = 0;
      if(r[k].close > e30[k])
         lado = 1;
      else if(r[k].close < e30[k])
         lado = -1;
      if(lado == 0)
         continue;
      if(ladoAnt != 0 && lado != ladoAnt)
         cruces++;
      ladoAnt = lado;
     }
   return cruces;
  }

double Eficiencia(const MqlRates &r[], const int i, const int ventana)
  {
   int ini = i - ventana;
   if(ini < 0)
      return 1.0;
   double total = MathAbs(r[i].close - r[ini].close);
   double suma = 0;
   for(int k = ini + 1; k <= i; k++)
      suma += MathAbs(r[k].close - r[k-1].close);
   if(suma <= 0)
      return 1.0;
   return total / suma;
  }

// ER del tramo que origino el patron. La escalera emite justo DESPUES de un
// retroceso, y el retroceso es lo que hunde el ER de la ventana corta: medido
// solo en la vela de emision, el filtro rechazaba la tendencia sana que esta
// respirando. Se mide tambien al final del impulso y vale el mejor de los dos.
double ErDelTramo(const MqlRates &r[], const int barImpulso, const int barAhora, const int ventana)
  {
   double erAhora = Eficiencia(r, barAhora, ventana);
   if(barImpulso < 0 || barImpulso >= barAhora)
      return erAhora;
   double erImpulso = Eficiencia(r, barImpulso, ventana);
   return MathMax(erAhora, erImpulso);
  }

//--------------------------------------------------------------------
//  Cola de toques (maximo 3, como s.toques en nucleo.js)
//--------------------------------------------------------------------
void NuevaSecuencia(Secuencia &s)
  {
   ZeroMemory(s);
   s.ultimaEntrada = -100000;
  }

bool HayToque(const Secuencia &s)
  {
   return s.nT > 0;
  }

Toque UltimoToque(const Secuencia &s)
  {
   if(s.nT == 3)
      return s.t3;
   if(s.nT == 2)
      return s.t2;
   if(s.nT == 1)
      return s.t1;
   Toque z;
   ZeroMemory(z);
   return z;
  }

// Devuelve true solo si el toque entro en la escalera. El 4.º no existe
// (§10): no se emite, no reemplaza el nivel del 3.º y no desplaza sus stops.
bool PushToque(Secuencia &s, const Toque &t)
  {
   if(s.nT >= 3)
      return false;
   if(s.nT == 0)
      s.t1 = t;
   else if(s.nT == 1)
      s.t2 = t;
   else
      s.t3 = t;
   s.nT++;
   return true;
  }

//--------------------------------------------------------------------
//  Un lado de una vela (espejo del bucle de _escanearCore)
//--------------------------------------------------------------------
void Emitir(Evento &eventos[], const int i, const bool venta, const string patron,
            const double precio, const double invalida, const double nivel,
            const double E30, const double E50, const double E100, const double cierre)
  {
   Evento ev;
   ev.bar       = i;
   ev.lado      = venta ? "VENTA" : "COMPRA";
   ev.patron    = patron;
   ev.precio    = precio;
   ev.invalida  = invalida;
   ev.nivel     = nivel;
   ev.tendencia = Tendencia(cierre, E30, E50, E100);
   int t = ArraySize(eventos);
   ArrayResize(eventos, t + 1);
   eventos[t] = ev;
  }

void ProcesarBarra(const MqlRates &r[], const int i, const bool venta,
                   const double &e30[], const double &e50[], const double &e100[],
                   const double &atr[], Secuencia &s, Evento &eventos[])
  {
   double c = r[i].close, h = r[i].high, l = r[i].low, o = r[i].open;
   double atrI = atr[i];
   double E30 = e30[i], E50 = e50[i], E100 = e100[i];
   // "con cuerpo" (la definicion de la §9): >= 50 % del rango y >= 0.10 ATR.
   // La pared de la EMA50 solo descarta el retroceso cuando la vela CIERRA
   // con cuerpo al otro lado; pincharla con la mecha no descarta nada.
   double cuerpoBarra = MathAbs(c - o);
   bool   conCuerpo   = (h - l) > 0 && cuerpoBarra >= P_cuerpoMin * (h - l)
                        && cuerpoBarra >= P_cuerpoMinAtr * atrI;

   // 4a + 2b. Cerrar CON CUERPO al otro lado de la EMA100 es cambio de
   // tendencia. La mecha puede pincharla sin castigo; el cierre no. Cuando
   // cruza, la escalera vuelve a 1 (y pierde la R) y el engano queda anulado
   // hasta que el precio regrese al lado de la tendencia.
   if(venta ? (c > E100) : (c < E100))
     {
      if(i == g_barraActual && (s.nT > 0 || s.engano))
         Log("[CAMBIO] " + (venta?"VENTA":"COMPRA") + " " + g_tfTxt
             + " cerro con cuerpo mas alla de la EMA100: escalera a 1");
      s.nT = 0;
      s.ciclo = 0;
      s.avisados = 0;
      s.supero   = false;
      s.pico     = 0;
      s.emitida  = false;
      s.retesteo = false;
      s.toco30 = false;
      s.confPend = false;
      s.confCont = 0;
      s.engano = false;
      s.enganoBloq = true;
      s.enganoBar = -1;
      s.enganoNivel = 0;
      s.enganoExtremo = 0;
      return;
     }

   // 3x. La confirmacion del toque se cuenta en TODAS las velas, tambien en
   // las que luego salen por una puerta anterior (alineacion, retesteo).
   // Contarla solo al final dejaba pasar velas en contra sin revisar y el
   // toque salia con una sola vela a favor.
   if(s.confPend)
     {
      // 1a. cerrar CON CUERPO al otro lado de la EMA50 descarta el retroceso
      // entero. Con la mecha pinchando la 50 no se descarta nada.
      if((venta ? (c > E50) : (c < E50)) && conCuerpo)
        {
         if(i == g_barraActual)
            Log("[FILTRO] " + (venta?"VENTA":"COMPRA") + " toque " + g_tfTxt
                + " descartado: el retroceso cerro mas alla de la EMA50");
         s.confPend = false;
         s.confCont = 0;
        }
      else
        {
         s.confExtremo = venta ? MathMax(s.confExtremo, h) : MathMin(s.confExtremo, l);
         if(venta ? (c < o) : (c > o))
            s.confCont++;
         else
           {
            if(i == g_barraActual)
               Log("[FILTRO] " + (venta?"VENTA":"COMPRA") + " toque " + g_tfTxt
                   + " descartado: la vela no continuo la tendencia");
            s.confPend = false;
            s.confCont = 0;
           }
        }

      if(s.confPend && s.confCont >= P_velasConfirmacion)
        {
         bool hayT0 = HayToque(s);
         Toque t0;
         ZeroMemory(t0);
         if(hayT0)
            t0 = UltimoToque(s);
         Toque t;
         t.bar     = i;
         t.nivel   = E30;
         t.extremo = s.confExtremo;   // la punta del retroceso, no la vela de vuelta
         t.alto    = h;
         t.bajo    = l;
         // §10: el toque 4 no existe. Si la escalera ya tiene 3, esta
         // confirmacion no entra, no reemplaza el nivel del 3.º y no toca
         // la raya de la B.
         bool aceptado = PushToque(s, t);
         s.confPend = false;
         s.confCont = 0;
         s.toco30   = false;
         s.supero = false;   // el proximo toque vuelve a exigir extremo nuevo
         if(aceptado)
           {
            // la raya que tiene que romper la B, con la punta de esta vela dentro
            double picoB = s.pico;
            if(picoB == 0)
               picoB = venta ? l : h;
            s.nivelB = venta ? MathMin(picoB, l) : MathMax(picoB, h);
            s.bHecho = false;
            if(i == g_barraActual)
               g_emb[g_tfIdx].toqW++;
           }

         // El toque 1 tambien avisa: los tres son la misma jugada y el numero
         // es el orden del toque en la escalera (1, 2, 3). La R la pone
         // ConReset cuando la escalera nacio de un engano.
         if(aceptado && s.nT <= 3 && s.avisados != s.nT)
           {
            int cr = CrucesEma30(r, e30, i, P_ventanaCruces);
            double er = ErDelTramo(r, hayT0 ? t0.bar : -1, i, P_ventanaER);
            double sep1 = venta ? (E50 - E30) / atrI : (E30 - E50) / atrI;
            double sep2 = venta ? (E100 - E50) / atrI : (E50 - E100) / atrI;
            string motivo = " ER=" + DoubleToString(er, 2)
                          + " sep=" + DoubleToString(sep1, 2) + "/" + DoubleToString(sep2, 2);
            if(cr >= P_minCrucesBloqueo)
              {
               if(i == g_barraActual)
                 {
                  g_emb[g_tfIdx].blqW++;
                  Log("[FILTRO] " + (venta?"VENTA":"COMPRA") + " toque" + IntegerToString(s.nT)
                      + " " + g_tfTxt + " bloqueado: cruces=" + IntegerToString(cr) + motivo);
                 }
              }
            else
              {
               if(i == g_barraActual)
                  g_emb[g_tfIdx].emiW++;
               Emitir(eventos, i, venta, ConReset(IntegerToString(s.nT), s.ciclo), c,
                      s.confExtremo, E30, E30, E50, E100, c);
               s.ultimaEntrada = i;
               s.avisados = s.nT;   // solo si de verdad se emitio
               s.emitida  = true;
              }
           }
        }
     }

   // 1. el precio se salio del techo (EMA50): nace el engano
   //    Si antes cerro sobre la EMA100 el engaño quedo anulado: no se rearma
   //    hasta que el precio vuelva del lado de la tendencia.
   bool salio = venta ? (c > E50) : (c < E50);
   if(!salio)
      s.enganoBloq = false;
   if(salio && !(s.enganoBloq && !s.engano))
     {
      if(!s.engano)
        {
         s.engano = true;
         s.enganoNivel = venta ? l : h;
         s.enganoExtremo = venta ? h : l;
        }
      else
        {
         s.enganoNivel = venta ? MathMin(s.enganoNivel, l) : MathMax(s.enganoNivel, h);
         s.enganoExtremo = venta ? MathMax(s.enganoExtremo, h) : MathMin(s.enganoExtremo, l);
        }
      s.enganoBar = i;
      // Salir por encima de la EMA50 NO borra la escalera: la §2 solo
      // descarta el retroceso y la §5 solo borra la escalera cuando la pila
      // se invierte. Aqui unicamente se rearma la punta de la pata en curso,
      // que es contra la que se mide "la tendencia avanzo" (§4).
      s.pico     = 0;
      s.retesteo = false;
     }

   // 1c. retesteo pendiente de la 2B: se espera la vuelta al nivel roto
   if(s.retesteo)
     {
      bool prueba    = venta ? (h >= s.retNivel - P_tolRetesteoAtr * atrI)
                             : (l <= s.retNivel + P_tolRetesteoAtr * atrI);
      bool sigueRoto = venta ? (c < s.retNivel) : (c > s.retNivel);
      if(prueba && sigueRoto)
        {
         // §10: la pila solo exige ORDEN; no se exige separacion entre EMAs.
         bool alineadaAhora = venta ? (c < E30 && E30 <= E50 && E50 <= E100)
                                    : (c > E30 && E30 >= E50 && E50 >= E100);
         if(!alineadaAhora)
           {
            s.retesteo = false;
            return;
           }
         Emitir(eventos, i, venta, ConReset("2B", s.ciclo), c, s.retExtremo, s.retNivel,
                E30, E50, E100, c);
         s.ultimaEntrada = i;
         s.nT = 0;
         s.avisados = 0;
         s.emitida  = false;
         s.retesteo = false;
         s.pico     = 0;
         s.engano = false;
         s.enganoBar = -1;
         s.enganoNivel = 0;
         s.enganoExtremo = 0;
         return;
        }
      if(!sigueRoto || i - s.retBar > P_caducidadRetesteo)
         s.retesteo = false;
      else
         return;   // esperando la vuelta al nivel: la secuencia no se toca
     }

   // 2. la pila EMA tiene que estar en ORDEN en el sentido de la jugada.
   //    Sin cierre ni separaciones minimas: el cierre lo exige la vuelta del
   //    toque (mas abajo) y exigir separacion dejaba la senal muda justo
   //    despues de un retroceso a la EMA30, que pega la EMA30 a la EMA50.
   bool alineada = venta ? (E30 <= E50 && E50 <= E100)
                         : (E30 >= E50 && E50 >= E100);
   if(!alineada)
     {
      if(i == g_barraActual)
         g_emb[g_tfIdx].noAlinW++;
      bool invertida = venta ? (E30 > E50) : (E30 < E50);
      if(invertida)
        {
         // Cambio de estructura: la escalera se reinicia y vuelve a 1, 2, 3
         // SIN R. La R solo la pone la seductora dentro de la escalera.
         s.nT = 0;
         s.ciclo = 0;
         s.avisados = 0;
         s.supero   = false;
         s.pico     = 0;
         s.emitida  = false;
         s.retesteo = false;
         s.toco30 = false;
         s.engano = false;
         s.enganoBar = -1;
         s.enganoNivel = 0;
         s.enganoExtremo = 0;
        }
      return;
     }

   // 3. toque a la EMA30 y vuelta del retroceso.
   //    1a. Regla del propietario: el retroceso toca la EMA30 y la MECHA
   //    puede pinchar la EMA50 todo lo que quiera, pero el CIERRE no puede
   //    quedar al otro lado. Si cierra alla, ese retroceso ya no es un toque:
   //    se descarta y se empieza de nuevo.
   //    4a. Con la EMA100 solo manda el cuerpo, y ahi cerrar es cambio de
   //    tendencia (se trata arriba, antes de llegar aqui).
   double tol30 = P_tolToqueAtr * atrI;
   bool llego30      = venta ? (h >= E30 - tol30) : (l <= E30 + tol30);
   bool cerroSobre50 = venta ? (c > E50) : (c < E50);
   if(i == g_barraActual && llego30)
      g_emb[g_tfIdx].tocaW++;

   if(cerroSobre50 && conCuerpo && (s.toco30 || s.confPend))
     {
      if(i == g_barraActual)
         Log("[FILTRO] " + (venta?"VENTA":"COMPRA") + " toque " + g_tfTxt
             + " descartado: el retroceso cerro mas alla de la EMA50");
      s.toco30   = false;
      s.confPend = false;
      s.confCont = 0;
     }

   if(!s.toco30 && !s.confPend && !cerroSobre50 && llego30)
     {
      s.toco30 = true;
      s.toco30Extremo = venta ? h : l;
     }
   if(s.toco30)
      s.toco30Extremo = venta ? MathMax(s.toco30Extremo, h) : MathMin(s.toco30Extremo, l);

   bool hayUltimo = HayToque(s);
   Toque ultimo;
   ZeroMemory(ultimo);
   if(hayUltimo)
      ultimo = UltimoToque(s);

   // Extremo de la pata en curso: la punta del impulso, no la vela del
   // retroceso. Del toque 2 en adelante el precio TIENE que romperlo: si la
   // tendencia no avanzo, el toque no cuenta y no se repite la senal.
   if(s.pico == 0)
      s.pico = venta ? l : h;
   if(hayUltimo && (venta ? (l < s.pico) : (h > s.pico)))
      s.supero = true;
   s.pico = venta ? MathMin(s.pico, l) : MathMax(s.pico, h);

   bool separado = !hayUltimo || (i - ultimo.bar) >= P_separacionToques;
   // el toque 1 no exige nada; el 2 y el 3 solo valen con extremo roto
   bool supera = !hayUltimo || s.supero;

   // 1a: si el cierre no puede pasar de la EMA50, la vuelta es siempre por la
   // EMA30 (toque somero): no hay vuelta por la 50 ni cuerpo que exigir.
   double nivelVol = E30;
   bool deVuelta   = venta ? (c < nivelVol) : (c > nivelVol);

   // 3x. La vela de vuelta NO avisa: arranca la cuenta de velas de
   // continuacion. La cuenta y el aviso los lleva el bloque del principio de
   // la barra, para que ninguna puerta posterior se salte velas.
   if(s.toco30 && deVuelta && separado && supera)
     {
      s.confPend    = true;
      s.confCont    = 0;
      s.confExtremo = s.toco30Extremo;
      s.toco30      = false;
      if(i == g_barraActual)
         Log("[CONF] " + (venta?"VENTA":"COMPRA") + " toque " + g_tfTxt
             + " vuelta vista: esperando " + IntegerToString(P_velasConfirmacion)
             + " velas de continuacion");
     }

   // 3b. La B de cada toque: cierre CON CUERPO que rompe el extremo del
   //     impulso anterior y continua. Es una entrada adicional a la del
   //     toque, no la sustituye: despues del 1 va el 1B, del 2 el 2B, etc.
   if(P_bPorRuptura && s.nT > 0 && !s.bHecho)
     {
      double cuerpoB  = MathAbs(c - o);
      bool   cuerpoBok = (h - l) > 0 && cuerpoB >= P_cuerpoMin * (h - l)
                         && cuerpoB >= P_cuerpoMinAtr * atrI;
      bool   rompeB    = venta ? (c < s.nivelB) : (c > s.nivelB);
      if(rompeB && cuerpoBok)
        {
         double stopB = hayUltimo ? ultimo.extremo : s.confExtremo;
         if(i == g_barraActual)
            g_emb[g_tfIdx].emiW++;
         Emitir(eventos, i, venta, ConReset(IntegerToString(s.nT) + "B", s.ciclo),
                c, stopB, s.nivelB, E30, E50, E100, c);
         s.ultimaEntrada = i;
         s.bHecho = true;
        }
     }

   // 4. quiebre: cierre mas alla del nivel, dentro de la caducidad del toque
   bool enganoVivo = s.engano && (i - s.enganoBar) <= P_caducidadEngano;
   if(!HayToque(s) && !enganoVivo)
      return;
   // La caducidad del quiebre solo vale para la rama vieja de la 2B/3B: la
   // seductora (§6) no depende de la escalera de toques y no puede quedar
   // muda por un toque viejo.
   Toque t4;
   ZeroMemory(t4);
   bool toqueViejo = false;
   if(HayToque(s))
     {
      t4 = UltimoToque(s);
      toqueViejo = (i <= t4.bar || (i - t4.bar) > P_caducidad);
     }

   // Con P_bPorRuptura la B de cada toque la emite el bloque 3b (ruptura con
   // cuerpo) y esta rama vieja de quiebre no tiene que volver a emitirla:
   // era la que borraba la escalera entera en la vela siguiente al toque y
   // dejaba el 2 y el 3 sin poder existir (§1, §4).
   string base = "";
   if(!P_bPorRuptura && HayToque(s) && !toqueViejo && s.nT >= 3)
      base = "3B";
   else if(!P_bPorRuptura && HayToque(s) && !toqueViejo && s.nT == 2)
      base = "2B";
   else if(enganoVivo)
      base = "1S";   // la seductora: el "1" quedo para el primer toque
   else
      return;                       // sin toque y sin engano: no hay codigo

   // una sola entrada por secuencia: si la 2/3 ya se emitio, su 2B/3B no sale
   if(P_unaPorSecuencia && s.emitida && base != "1S")
     {
      // se cierra la escalera sin marcar reset: un cierre no es un engano
      s.nT = 0;
      s.avisados = 0;
      s.emitida = false;
      s.pico    = 0;
      s.engano = false;
      s.enganoBar = -1;
      s.enganoNivel = 0;
      s.enganoExtremo = 0;
      return;
     }

   // base "1" = vuelta del engano. Con P_enganoEnEma50 el disparo es la vela
   // que CIERRA de vuelta a traves de la EMA50 en la direccion de la tendencia;
   // si no, el minimo del tramo (el "cuello"), que llega mas tarde y peor.
   double nivelQ = (base == "1S") ? (P_enganoEnEma50 ? E50 : s.enganoNivel) : t4.nivel;
   if(!(nivelQ > 0))
      return;
   bool rompe = venta ? (c < nivelQ) : (c > nivelQ);
   if(!rompe)
      return;

   // "con cuerpo": la vela que quiebra tiene que ser una vela de verdad
   double cuerpo = MathAbs(c - o);
   double rango  = h - l;
   if(!(rango > 0) || (cuerpo / rango) < P_cuerpoMin || cuerpo < P_cuerpoMinAtr * atrI)
      return;
   if(cuerpo > 3.0 * atrI)
      return;   // vela gigante: esperar micro-retroceso

   // Filtros anti-ruido en el quiebre
   int crQ = CrucesEma30(r, e30, i, P_ventanaCruces);
   double erQ = ErDelTramo(r, HayToque(s) ? t4.bar : -1, i, P_ventanaER);
   double sep1Q = venta ? (E50 - E30) / atrI : (E30 - E50) / atrI;
   double sep2Q = venta ? (E100 - E50) / atrI : (E50 - E100) / atrI;
   bool bloqueadoQ = false;
   string motivoQ = "";
   if(crQ >= P_minCrucesBloqueo) { bloqueadoQ = true; motivoQ = motivoQ + " cruces=" + IntegerToString(crQ); }
   if(erQ < P_erMinQuiebre)      { bloqueadoQ = true; motivoQ = motivoQ + " ER=" + DoubleToString(erQ, 2); }
   // la separacion ya vive dentro de "alineada": aqui solo se mide
   motivoQ = motivoQ + " sep=" + DoubleToString(sep1Q, 2) + "/" + DoubleToString(sep2Q, 2);
   if(bloqueadoQ)
     {
      if(i == g_barraActual)
         Log("[FILTRO] " + (venta?"VENTA":"COMPRA") + " quiebre " + base
             + " " + g_tfTxt + " bloqueado:" + motivoQ);
      return;
     }

   // la 2B no se opera al cierre: se espera el retesteo del nivel. Solo en la
   // rama vieja: con P_bPorRuptura la B ya se avisa en la ruptura con cuerpo.
   if(base == "2B")
     {
      s.retesteo = true;
      s.retBar = i;
      s.retNivel = nivelQ;
      s.retExtremo = t4.extremo;
      return;
     }

   // el stop de la vuelta del engano es la PUNTA del tramo; el extremo del
   // toque vale 0 cuando nT==0 y dejaba la invalidacion en el precio 0.
   double invalidaQ = (base == "1S") ? s.enganoExtremo : t4.extremo;
   if(!(invalidaQ > 0))
      return;

   Emitir(eventos, i, venta, ConReset(base, s.ciclo), c, invalidaQ, nivelQ, E30, E50, E100, c);
   s.ultimaEntrada = i;
   // La R significa UNA cosa: la escalera nacio de un engano (reset). Solo la
   // seductora marca el reset; un 2B/3B o un toque no son un reset.
   if(base == "1S")
      s.ciclo++;
   s.pico = 0;
   s.supero = false;
   s.nT = 0;
   s.avisados = 0;
   s.emitida  = false;
   s.engano = false;
   s.enganoBar = -1;
   s.enganoNivel = 0;
   s.enganoExtremo = 0;
  }

//--------------------------------------------------------------------
//  Escaneo completo de una serie (puro, como escanear() en nucleo.js)
//--------------------------------------------------------------------
void Escanear(const MqlRates &r[], Evento &eventos[])
  {
   ArrayResize(eventos, 0);
   int n = ArraySize(r);
   if(n < P_emaFondo + 5)
      return;
   g_barraActual = n - 1;   // solo la vela recien cerrada escribe log

   double cierres[];
   ArrayResize(cierres, n);
   for(int i=0; i<n; i++)
      cierres[i] = r[i].close;

   double e30[], e50[], e100[], atr[];
   CalcEma(cierres, P_emaContacto, e30);
   CalcEma(cierres, P_emaTecho, e50);
   CalcEma(cierres, P_emaFondo, e100);
   CalcAtr(r, P_atrPeriodo, atr);

   Secuencia venta, compra;
   NuevaSecuencia(venta);
   NuevaSecuencia(compra);

   for(int i = P_emaFondo; i < n; i++)
     {
      if(!(atr[i] > 0) || !(e30[i] > 0) || !(e50[i] > 0) || !(e100[i] > 0))
         continue;
      ProcesarBarra(r, i, true,  e30, e50, e100, atr, venta,  eventos);
      ProcesarBarra(r, i, false, e30, e50, e100, atr, compra, eventos);
     }
  }

//--------------------------------------------------------------------
//  Mensaje: mismo formato de 7 campos que formatearSenal (telegram.js)
//--------------------------------------------------------------------
string MensajeSenal(const string simbolo, const string tf, const Evento &ev,
                    const datetime tVelaUTC, const string extraTend)
  {
   bool compra = (ev.lado == "COMPRA");
   string patron = ev.patron;
   if(StringFind(patron, "R") >= 0)
      patron = patron + " (reset)";
   string texto = "";
   texto += Icono(compra) + " <b>" + ev.lado + "</b>\n";
   texto += "<b>1. Activo:</b> " + simbolo + "\n";
   texto += "<b>2. Temporalidad:</b> " + tf + "\n";    string estrategia = (StringFind(ev.patron, "E") >= 0) ? "Estructura" : "Wonderizada";
   texto += "<b>3. Estrategia:</b> " + patron + " - " + estrategia + "\n";
   texto += "<b>4. Tendencia:</b> " + TendenciaTxt(ev.tendencia) + extraTend + "\n";
   texto += "<b>5. Precio entrada:</b> " + FmtPrecio(ev.precio) + " (vela cerrada)\n";
   texto += "<b>6. Invalidación:</b> " + FmtPrecio(ev.invalida) + "\n";
   texto += "<b>7. Hora:</b> " + HoraHabana(tVelaUTC) + " (Habana)";
   return texto;
  }

//--------------------------------------------------------------------
//  Antiduplicado entre reinicios del EA
//--------------------------------------------------------------------
string g_enviadas[];

bool YaEnviada(const string clave)
  {
   int n = ArraySize(g_enviadas);
   for(int i=0; i<n; i++)
      if(g_enviadas[i] == clave)
         return true;
   return false;
  }

void MarcarEnviada(const string clave)
  {
   int n = ArraySize(g_enviadas);
   ArrayResize(g_enviadas, n + 1);
   g_enviadas[n] = clave;
   if(n >= 2000)
     {
      // Topar la lista EN MEMORIA tambien: antes solo se recortaba el archivo
      // y g_enviadas crecia sin limite (YaEnviada es una busqueda lineal).
      ArrayRemove(g_enviadas, 0, n - 999);   // deja las 1000 ultimas + esta
      int h0 = FileOpen("adv_enviados.txt", FILE_WRITE|FILE_TXT|FILE_ANSI);
      if(h0 != INVALID_HANDLE)
        {
         int m = ArraySize(g_enviadas);
         for(int i = 0; i < m; i++)
            FileWrite(h0, g_enviadas[i]);
         FileClose(h0);
        }
      return;
     }
   int h = FileOpen("adv_enviados.txt", FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   if(h == INVALID_HANDLE)
      return;
   FileSeek(h, 0, SEEK_END);
   FileWrite(h, clave);
   FileClose(h);
  }

void CargarEnviadas()
  {
   int h = FileOpen("adv_enviados.txt", FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ);
   if(h == INVALID_HANDLE)
      return;
   while(!FileIsEnding(h))
     {
      string l = FileReadString(h);
      StringTrimLeft(l);
      StringTrimRight(l);
      if(StringLen(l) > 0)
        {
         int n = ArraySize(g_enviadas);
         ArrayResize(g_enviadas, n + 1);
         g_enviadas[n] = l;
        }
     }
   FileClose(h);
   Log("Antiduplicado: " + IntegerToString(ArraySize(g_enviadas)) + " senales previas recordadas");
  }

//--------------------------------------------------------------------
//  Estado por simbolo
//--------------------------------------------------------------------
struct EstadoSim
  {
   string   nombre;
   datetime ultimaBarra[4];   // por cada TF (M3,M5,M15,M30)
   int      senales[4];       // por cada TF
   bool     avisado;
  };

EstadoSim g_est[];

void Revisar(const int idx)
  {
   if(StringLen(g_est[idx].nombre) == 0)
      return;

   for(int tfi = 0; tfi < g_nTf; tfi++)
     {
      g_tf    = g_tfArr[tfi];
      g_tfTxt = g_tfTxtArr[tfi];
      g_tfIdx = tfi;

      // Chequeo barato antes de copiar: si la vela en formacion no cambio, no
      // cerro nada nuevo. Antes se copiaban 3000 velas x 4 TF x 4 simbolos
      // cada 10 s aunque no hubiera barra nueva.
      datetime formando = iTime(g_est[idx].nombre, g_tf, 0);
      if(formando > 0 && formando == g_est[idx].ultimaBarra[tfi])
         continue;

      MqlRates r[];
      int n = CopyRates(g_est[idx].nombre, g_tf, 1, g_velas, r);
      if(n < P_emaFondo + 30)
        {
         if(!g_est[idx].avisado)
           {
            Log(g_est[idx].nombre + ": solo " + IntegerToString(n) + " velas " + g_tfTxt
                + " (necesito " + IntegerToString(P_emaFondo + 30) + "). Espero.");
            g_est[idx].avisado = true;
           }
         continue;
        }
      g_est[idx].avisado = false;
      // se guarda la vela en formacion: si sigue igual, no hay nada nuevo
      if(formando > 0)
         g_est[idx].ultimaBarra[tfi] = formando;
      datetime ultima = r[n-1].time;

      Evento evs[], evsE[];
      Escanear(r, evs);
      EscanearEstructura(r, evsE);

      // candidatos de la vela recien cerrada, de las dos estrategias
      Evento cand[];
      ArrayResize(cand, 0);
      int t1 = ArraySize(evs);
      for(int i=0; i<t1; i++)
         if(evs[i].bar == n - 1)
           {
            int k = ArraySize(cand);
            ArrayResize(cand, k + 1);
            cand[k] = evs[i];
           }
      int t2 = ArraySize(evsE);
      for(int i=0; i<t2; i++)
         if(evsE[i].bar == n - 1)
           {
            int k = ArraySize(cand);
            ArrayResize(cand, k + 1);
            cand[k] = evsE[i];
           }

      long offServidor = (long)TimeTradeServer() - (long)TimeGMT();
      datetime tCierre  = (datetime)((long)ultima + (long)PeriodSeconds(g_tf));
      datetime tCierreUTC = (datetime)((long)tCierre - offServidor);

      // una sola senal por vela y lado: gana la de mayor prioridad
      for(int lado = 0; lado < 2; lado++)
        {
         string cual = (lado == 0) ? "VENTA" : "COMPRA";
         int mejor = -1;
         int nc = ArraySize(cand);
         for(int i = 0; i < nc; i++)
           {
            if(cand[i].lado != cual)
               continue;
            if(mejor < 0 || Prioridad(cand[i].patron) > Prioridad(cand[mejor].patron))
               mejor = i;
           }
         if(mejor < 0)
            continue;

         Evento ev = cand[mejor];
         string clave = g_est[idx].nombre + "|" + g_tfTxt + "|" + IntegerToString((long)ultima)
                        + "|" + ev.lado + "|" + ev.patron;
         if(YaEnviada(clave))
            continue;

         TendMayor tm = TendenciaMayor(g_est[idx].nombre, tCierre);
         string extra = SufijoTendencia(tm, g_tfTxt);
         // El H1 NO es un filtro del documento (§7 solo fija ER y cruces):
         // el estado de H1 se escribe en la senal y en el log, pero no veta
         // ninguna temporalidad.
         if(tm.ok && tm.tendencia != "RANGO")
           {
            bool contra = (ev.lado == "VENTA"  && tm.tendencia == "ALCISTA")
                       || (ev.lado == "COMPRA" && tm.tendencia == "BAJISTA");
            if(contra)
               Log("[AVISO H1] " + ev.lado + " " + g_est[idx].nombre + " " + g_tfTxt + " contra H1 "
                   + tm.tendencia + " (" + tm.fase + ", rotura hace "
                   + IntegerToString(tm.velasRotura) + " velas H1): sale avisada");
           }
         string texto = MensajeSenal(g_est[idx].nombre, g_tfTxt, ev, tCierreUTC, extra);
         Log("[SENAL] " + ev.lado + " " + g_est[idx].nombre + " " + g_tfTxt + " "
             + ev.patron + " precio=" + FmtPrecio(ev.precio) + extra);
         if(EnviarTelegram(texto))
           {
            MarcarEnviada(clave);
            g_est[idx].senales[tfi]++;
           }
        }
     }
  }

//--------------------------------------------------------------------
//  BACKTEST: CSV de senales y de barras
//  Se usa FILE_COMMON para que el runner los recoja siempre del mismo
//  sitio: en el tester los archivos normales caen en el sandbox del
//  agente (Tester\Agent-xxx\MQL5\Files) y es un lio encontrarlos.
//--------------------------------------------------------------------
string BtRuta(const string archivo)
  {
   return InpBtCarpeta + "\\" + archivo;
  }

void BtInit()
  {
   g_bt = true;
   FolderCreate(InpBtCarpeta, FILE_COMMON);
   g_btHsen = FileOpen(BtRuta("senales.csv"), FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
   if(g_btHsen != INVALID_HANDLE)
      FileWrite(g_btHsen, "id;time;symbol;tf;code;dir;entry;stop;atr;tipo;h1");
   for(int tfi = 0; tfi < g_nTf; tfi++)
     {
      g_btUltBarra[tfi] = 0;
      g_btHbar[tfi]     = INVALID_HANDLE;
      if(!InpBtBarras)
         continue;
      g_btHbar[tfi] = FileOpen(BtRuta("barras_" + g_tfTxtArr[tfi] + ".csv"),
                               FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON);
      if(g_btHbar[tfi] != INVALID_HANDLE)
         FileWrite(g_btHbar[tfi], "time;open;high;low;close");
     }
   Print("BT: simbolo=", _Symbol, " ventana=", InpBtVentana,
         " barras=", (InpBtBarras ? "si" : "no"), " -> ", BtRuta("senales.csv"));
  }

void BtCerrar()
  {
   if(g_btHsen != INVALID_HANDLE)
     {
      FileClose(g_btHsen);
      g_btHsen = INVALID_HANDLE;
     }
   for(int tfi = 0; tfi < g_nTf; tfi++)
      if(g_btHbar[tfi] != INVALID_HANDLE)
        {
         FileClose(g_btHbar[tfi]);
         g_btHbar[tfi] = INVALID_HANDLE;
        }
  }

// aviso vs entrada: solo 2E/3E (y sus reseteadas) son avisos de Estructura,
// tal y como los llama la §8. Los toques 2 y 3 son entradas de la escalera
// (§4) y en vivo se mandan igual que el 1: con entrada, stop y nivel.
bool BtEsEntrada(const string p)
  {
   if(p == "2E" || p == "3E" || p == "2RE" || p == "3RE") return false;
   return true;
  }

void BtSenal(const string tf, const Evento &ev, const datetime tBarra,
             const double atr, const string h1)
  {
   if(g_btHsen == INVALID_HANDLE)
      return;
   g_btEventos++;
   FileWrite(g_btHsen,
             IntegerToString(g_btEventos) + ";" +
             TimeToString(tBarra, TIME_DATE|TIME_MINUTES) + ";" +
             _Symbol + ";" + tf + ";" + ev.patron + ";" + ev.lado + ";" +
             DoubleToString(ev.precio, _Digits) + ";" +
             DoubleToString(ev.invalida, _Digits) + ";" +
             DoubleToString(atr, _Digits) + ";" +
             (BtEsEntrada(ev.patron) ? "ENTRADA" : "AVISO") + ";" + h1);
  }

// Un paso del tester: por cada TF mira si cerro una vela nueva, guarda la
// barra y escribe las senales de ESA vela (misma logica que Revisar en vivo).
void BtPaso()
  {
   for(int tfi = 0; tfi < g_nTf; tfi++)
     {
      g_tf    = g_tfArr[tfi];
      g_tfTxt = g_tfTxtArr[tfi];
      g_tfIdx = tfi;

      MqlRates r[];
      int n = CopyRates(_Symbol, g_tf, 1, InpBtVentana, r);   // 1 = ultima CERRADA
      if(n < P_emaFondo + 30)
         continue;
      datetime tBarra = r[n-1].time;
      if(tBarra == g_btUltBarra[tfi])
         continue;
      g_btUltBarra[tfi] = tBarra;

      if(g_btHbar[tfi] != INVALID_HANDLE)
         FileWrite(g_btHbar[tfi],
                   TimeToString(tBarra, TIME_DATE|TIME_MINUTES) + ";" +
                   DoubleToString(r[n-1].open,  _Digits) + ";" +
                   DoubleToString(r[n-1].high,  _Digits) + ";" +
                   DoubleToString(r[n-1].low,   _Digits) + ";" +
                   DoubleToString(r[n-1].close, _Digits));

      Evento evs[], evsE[];
      Escanear(r, evs);
      EscanearEstructura(r, evsE);

      Evento cand[];
      ArrayResize(cand, 0);
      int t1 = ArraySize(evs);
      for(int i = 0; i < t1; i++)
         if(evs[i].bar == n - 1)
           {
            int k = ArraySize(cand);
            ArrayResize(cand, k + 1);
            cand[k] = evs[i];
           }
      int t2 = ArraySize(evsE);
      for(int i = 0; i < t2; i++)
         if(evsE[i].bar == n - 1)
           {
            int k = ArraySize(cand);
            ArrayResize(cand, k + 1);
            cand[k] = evsE[i];
           }
      if(ArraySize(cand) == 0)
         continue;

      double atr[];
      CalcAtr(r, P_atrPeriodo, atr);
      double atrS = atr[n-1];

      datetime tCierre = (datetime)((long)tBarra + (long)PeriodSeconds(g_tf));
      TendMayor tm = TendenciaMayor(_Symbol, tCierre);
      string h1 = SufijoTendencia(tm, g_tfTxt);

      // una sola senal por vela y lado: gana la de mayor prioridad
      for(int lado = 0; lado < 2; lado++)
        {
         string cual = (lado == 0) ? "VENTA" : "COMPRA";
         int mejor = -1;
         int nc = ArraySize(cand);
         for(int i = 0; i < nc; i++)
           {
            if(cand[i].lado != cual)
               continue;
            if(mejor < 0 || Prioridad(cand[i].patron) > Prioridad(cand[mejor].patron))
               mejor = i;
           }
         if(mejor < 0)
            continue;
         Evento ev = cand[mejor];
         // mismo criterio que en vivo: el H1 se anota en la senal, no veta
         BtSenal(g_tfTxt, ev, tBarra, atrS, h1);
        }
     }
  }

//--------------------------------------------------------------------
//  Arranque
//--------------------------------------------------------------------
int OnInit()
  {
   Log("=== EstrategiaAdversaria 1.00 ===");
   CargarCfg("adv.cfg");
   CargarEnviadas();

   // Multi-TF: inicializar arrays de temporalidades
   ArrayResize(g_tfTxtArr, g_nTf);
   ArrayResize(g_tfArr, g_nTf);
   g_tfTxtArr[0] = "M3";  g_tfArr[0] = PERIOD_M3;
   g_tfTxtArr[1] = "M5";  g_tfArr[1] = PERIOD_M5;
   g_tfTxtArr[2] = "M15"; g_tfArr[2] = PERIOD_M15;
   g_tfTxtArr[3] = "M30"; g_tfArr[3] = PERIOD_M30;
   g_tfTxt = g_tfTxtArr[1];   // default para logs
   g_tf    = g_tfArr[1];

   // Modo backtest: no hay cuenta, ni Telegram, ni timer. El tester empuja
   // vela a vela por OnTick y todo sale a CSV.
   if(InpBacktest || MQLInfoInteger(MQL_TESTER) != 0)
     {
      BtInit();
      return(INIT_SUCCEEDED);
     }

   long login     = AccountInfoInteger(ACCOUNT_LOGIN);
   string servidor = AccountInfoString(ACCOUNT_SERVER);
   // ENUM_ACCOUNT_TRADE_MODE: 0 = demo, 1 = concurso, 2 = real
   long modo      = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string modoTxt = (modo == 0) ? "demo" : ((modo == 1) ? "concurso" : "REAL");
   Log("Cuenta " + IntegerToString(login) + " en " + servidor + " (" + modoTxt + ")");
   if(modo != 0)
      Log("OJO: ACCOUNT_TRADE_MODE no es demo. Revisa con que cuenta estas entrando.");

   string partes[];
   int np = StringSplit(g_simbolos, StringGetCharacter(",", 0), partes);
   string listaOk = "";
   for(int i=0; i<np; i++)
     {
      string pedido = partes[i];
      StringTrimLeft(pedido);
      StringTrimRight(pedido);
      if(StringLen(pedido) == 0)
         continue;
      string real = ResolverSimbolo(pedido);
      int k = ArraySize(g_est);
      ArrayResize(g_est, k + 1);
      g_est[k].nombre = real;
      for(int tfi = 0; tfi < g_nTf; tfi++)
        {
         g_est[k].ultimaBarra[tfi] = 0;
         g_est[k].senales[tfi]     = 0;
        }
      g_est[k].avisado = false;
      if(StringLen(real) == 0)
        {
         Log("SIMBOLO NO ENCONTRADO: '" + pedido + "' (revisa el nombre en Market Watch)");
         continue;
        }
      if(real != pedido)
         Log("Simbolo '" + pedido + "' resuelto como '" + real + "'");
      listaOk += (StringLen(listaOk) > 0 ? ", " : "") + real;
     }

   string tfLista = "";
   for(int tfi = 0; tfi < g_nTf; tfi++)
      tfLista += (tfi > 0 ? "," : "") + g_tfTxtArr[tfi];
   Log("Vigilando " + IntegerToString(ArraySize(g_est)) + " simbolos en [" + tfLista + "]"
       + " (" + IntegerToString(g_velas) + " velas)" + " | Telegram: "
       + ((g_tgToken != "" && g_tgChat != "") ? "configurado" : "SIN CONFIGURAR"));
   EcoParametros();

   long offServidor = (long)TimeTradeServer() - (long)TimeGMT();
   Log("Desfase del servidor respecto a UTC: " + IntegerToString((int)(offServidor / 3600)) + " h");

   // Snapshot de precios al arrancar (para verificar que los activos coinciden con MT5)
   string snap = "Precios al arrancar:";
   for(int i=0; i<ArraySize(g_est); i++)
     {
      if(StringLen(g_est[i].nombre) == 0)
         continue;
      MqlRates r[];
      int m = CopyRates(g_est[i].nombre, g_tfArr[1], 0, 2, r);
      string precio = (m > 0) ? FmtPrecio(r[m-1].close) : "sin datos";
      snap = snap + "\n  " + g_est[i].nombre + " = " + precio;
     }

   string msg = "EA ADVERSARIO ARRANCADO";
   msg = msg + "\n" + "Cuenta: " + IntegerToString(login) + " - " + servidor + " (" + modoTxt + ")";
   msg = msg + "\n" + "Activos: " + (StringLen(listaOk) ? listaOk : "(ninguno resuelto)");
   msg = msg + "\n" + "Temporalidades: " + tfLista;
   msg = msg + "\n" + "Horario del servidor: UTC" + (offServidor >= 0 ? "+" : "")
         + IntegerToString((int)(offServidor / 3600));
   msg = msg + "\n" + snap;
   EnviarTelegram(msg);

   EventSetTimer(10);
   Log("Timer cada 10 s. Esperando cierres de vela.");
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_bt)
     {
      BtCerrar();
      Print("BT: fin, ", g_btEventos, " senales escritas");
     }
   Log("EA detenido (reason " + IntegerToString(reason) + ")");
  }

//--------------------------------------------------------------------
//  Panel web: snapshot de lo que ve el EA
//--------------------------------------------------------------------
// Escribe MQL5/Files/panel_estado.json con las ultimas P_panelVelas velas de
// cada simbolo y temporalidad, las EMAs y el ATR. NO decide nada: solo copia
// los mismos datos que usa Revisar(). El servidor del panel (panel/panel.mjs)
// lo sirve tal cual y el navegador dibuja. Se escribe una vez por vela M3.
#define P_panelVelas 200

void PanelEstado()
  {
   string j = "{";
   j += "\"generado\":\"" + TimeToString(TimeGMT(), TIME_DATE|TIME_SECONDS) + "\"";
   j += ",\"servidor\":\"" + EscJson(AccountInfoString(ACCOUNT_SERVER)) + "\"";
   j += ",\"login\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   j += ",\"modo\":\"" + ((AccountInfoInteger(ACCOUNT_TRADE_MODE) == 0) ? "demo" : "real") + "\"";
   j += ",\"velas\":" + IntegerToString(P_panelVelas);

   string tfs = "";
   for(int tfi = 0; tfi < g_nTf; tfi++)
      tfs += (tfi > 0 ? "," : "") + "\"" + EscJson(g_tfTxtArr[tfi]) + "\"";
   j += ",\"tfs\":[" + tfs + "]";

   j += ",\"simbolos\":[";
   int ns = ArraySize(g_est);
   bool primero = true;
   for(int i = 0; i < ns; i++)
     {
      if(StringLen(g_est[i].nombre) == 0)
         continue;
      if(!primero)
         j += ",";
      primero = false;

      double precio = 0.0, spread = 0.0;
      MqlRates rp[];
      int mp = CopyRates(g_est[i].nombre, g_tfArr[1], 0, 1, rp);
      if(mp > 0)
        {
         precio = rp[0].close;
         if(rp[0].spread > 0)
            spread = rp[0].spread * SymbolInfoDouble(g_est[i].nombre, SYMBOL_POINT);
        }

      j += "{\"simbolo\":\"" + EscJson(g_est[i].nombre) + "\"";
      j += ",\"precio\":" + DoubleToString(precio, 2);
      j += ",\"spread\":" + DoubleToString(spread, 2);
      j += ",\"tf\":[";

      for(int tfi = 0; tfi < g_nTf; tfi++)
        {
         if(tfi > 0)
            j += ",";
         j += "{\"tf\":\"" + EscJson(g_tfTxtArr[tfi]) + "\"";

         MqlRates r[];
         int n = CopyRates(g_est[i].nombre, g_tfArr[tfi], 1, P_panelVelas + P_emaFondo + 5, r);
         if(n < P_emaFondo + 5)
           {
            j += ",\"tend\":\"SIN DATOS\",\"velas\":[]}";
            continue;
           }

         double c[];
         ArrayResize(c, n);
         for(int k = 0; k < n; k++)
            c[k] = r[k].close;
         double e30[], e50[], e100[], atr[];
         CalcEma(c, P_emaContacto, e30);
         CalcEma(c, P_emaTecho, e50);
         CalcEma(c, P_emaFondo, e100);
         CalcAtr(r, P_atrPeriodo, atr);
         int li = n - 1;

         j += ",\"tend\":\"" + Tendencia(c[li], e30[li], e50[li], e100[li]) + "\"";
         j += ",\"e30\":" + DoubleToString(e30[li], 2);
         j += ",\"e50\":" + DoubleToString(e50[li], 2);
         j += ",\"e100\":" + DoubleToString(e100[li], 2);
         j += ",\"atr\":" + DoubleToString(atr[li], 2);

         // [tiempo, apertura, maximo, minimo, cierre] y las tres EMAs alineadas
         // con esas mismas velas, para que el navegador dibuje la curva real.
         j += ",\"velas\":[";
         int desde = n - P_panelVelas;
         if(desde < 0)
            desde = 0;
         for(int k = desde; k < n; k++)
           {
            if(k > desde)
               j += ",";
            j += "[" + IntegerToString((long)r[k].time) + ","
               + DoubleToString(r[k].open, 2) + ","
               + DoubleToString(r[k].high, 2) + ","
               + DoubleToString(r[k].low, 2) + ","
               + DoubleToString(r[k].close, 2) + "]";
           }
         j += "],\"ema\":[";
         for(int k = desde; k < n; k++)
           {
            if(k > desde)
               j += ",";
            j += "[" + DoubleToString(e30[k], 2) + ","
               + DoubleToString(e50[k], 2) + ","
               + DoubleToString(e100[k], 2) + "]";
           }
         j += "]}";
        }
      j += "]}";
     }
   j += "]}";

   int h = FileOpen("panel_estado.json", FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE)
     {
      Log("no pude escribir panel_estado.json (error " + IntegerToString(GetLastError()) + ")");
      return;
     }
   FileWriteString(h, j);
   FileClose(h);
  }

// En vivo el EA trabaja con OnTimer; en el tester los timers no existen y
// el pulso lo da OnTick (una vez por barra M1 con Model=1).
void OnTick()
  {
   if(g_bt)
      BtPaso();
  }

void OnTimer()
  {
   // Embudo: una linea por vela M3 cerrada con lo acumulado de todos los
   // simbolos. Se imprime aqui y no dentro de Revisar porque los contadores
   // son globales y Revisar corre una vez por simbolo.
   if(ArraySize(g_est) > 0 && StringLen(g_est[0].nombre) > 0)
     {
      datetime b3 = iTime(g_est[0].nombre, PERIOD_M3, 0);
      if(b3 > 0 && b3 != g_embBar)
        {
         if(g_embBar != 0)
            EmbLog();
         g_embBar = b3;
        }
      if(b3 > 0 && b3 != g_panelBar)
        {
         PanelEstado();
         // Captura real de la grafica de MT5 (con las EMAs/indicadores tal como
         // las pinta el terminal) para que el panel movil muestre "lo mismo de
         // MT5" y no una reconstruccion. Se sobrescribe en cada vela M3.
         ChartScreenShot(0, "panel_chart.png", 1280, 720);
         g_panelBar = b3;
        }
     }

   int n = ArraySize(g_est);
   for(int i=0; i<n; i++)
      Revisar(i);

   if(g_latidoMin <= 0)
      return;
   datetime ahora = TimeGMT();
   if(g_ultimoLatido == 0)
     {
      g_ultimoLatido = ahora;
      return;
     }
   if((long)ahora - (long)g_ultimoLatido < (long)g_latidoMin * 60)
      return;
   g_ultimoLatido = ahora;

   string txt = "latido:";
   for(int i=0; i<n; i++)
     {
      if(StringLen(g_est[i].nombre) == 0)
         continue;
      MqlRates r[];
      int m = CopyRates(g_est[i].nombre, g_tfArr[1], 0, 2, r);
      string precio = (m > 0) ? FmtPrecio(r[m-1].close) : "sin datos";
      int senTot = 0;
      for(int tfi = 0; tfi < g_nTf; tfi++)
         senTot += g_est[i].senales[tfi];
      txt = txt + " " + g_est[i].nombre + "=" + precio
            + "(senales " + IntegerToString(senTot) + ")";
     }
   Log(txt);
   // Estado H1 por simbolo, una vez por latido: evidencia numerica para
   // decidir si el veto por H1 esta midiendo la estructura o una etiqueta vieja.
   for(int i=0; i<n; i++)
     {
      if(StringLen(g_est[i].nombre) == 0)
         continue;
      string eh = EstadoH1(g_est[i].nombre);
      if(StringLen(eh) > 0)
         Log("[H1] " + g_est[i].nombre + ": " + eh);
     }
   if(g_enviarPrecios == 1 && g_tgToken != "" && g_tgChat != "")
      EnviarTelegram(txt);
  }

//====================================================================
//  Estrategia ESTRUCTURA (port de escanearEstructura de nucleo.js)
//  Impulso + retroceso + quiebre, con la misma puerta EMA.
//  Codigos: 1E (entrada), 2E/3E (avisos), 2EB/3EB (entradas con quiebre)
//  y sus reseteadas 1RE, 2RE/3RE, 2REB/3REB.
//====================================================================
double P_estImpulsoMinAtr   = 0.8;
int    P_estMinVelasImpulso = 2;
int    P_estMaxVelasImpulso = 3;
double P_estCuerpoImpulso   = 0.35;
// 20 velas = "el extremo del impulso tiene que ser el extremo de la ultima
// hora" en M3. Ningun impulso de 2-3 velas sobrevive a eso: en la practica
// la estrategia casi no llegaba a tener impulso. 8 velas mantiene la idea
// (el extremo sigue siendo el del tramo reciente) sin bloquearla.
int    P_estVentana         = 8;
// El retroceso no puede pasarse del origen del impulso (enRetroceso exige
// extremo <= impulsoOrigen), asi que la retraccion maxima posible es la
// ALTURA de la pierna. Con impulsoMinAtr=0.8 y retrocesoMin=1.0 el minimo
// quedaba POR ENCIMA del maximo alcanzable: cualquier pierna de 0.8 a 1.0
// ATR no podia generar toque nunca. 0.6 ATR abre la banda de verdad.
double P_estRetrocesoMinAtr = 0.6;
double P_estRetrocesoMaxAtr = 3.0;
int    P_estCaducidad       = 30;
// 30 velas de espera en M3 son 90 minutos de silencio despues de CADA
// entrada de Estructura. Es el mayor supresor de la estrategia.
int    P_estEspera          = 10;

//--------------------------------------------------------------------
//  Los parametros estan en VELAS, y la misma cifra son minutos distintos
//  segun la temporalidad. Esto se imprime al arrancar para no calibrar a
//  ciegas: "espera=10 velas" son 30 min en M3 y 5 horas en M30.
//--------------------------------------------------------------------
void EcoParametros()
  {
   for(int t = 0; t < g_nTf; t++)
     {
      ENUM_TIMEFRAMES tf = g_tfArr[t];
      string linea = "[EFECTIVO] " + g_tfTxtArr[t]
                     + " W{caducidad=" + IntegerToString(P_caducidad) + "v"
                     + " engano=" + IntegerToString(P_caducidadEngano) + "v"
                     + " cruces=" + IntegerToString(P_ventanaCruces) + "v"
                     + " ER=" + IntegerToString(P_ventanaER) + "v}"
                     + " E{ventana=" + IntegerToString(P_estVentana) + "v"
                     + " caducidad=" + IntegerToString(P_estCaducidad) + "v"
                     + " espera=" + IntegerToString(P_estEspera) + "v}";
      int mCad = (PeriodSeconds(tf) * P_caducidad) / 60;
      int mEr  = (PeriodSeconds(tf) * P_estEspera) / 60;
      int mVen = (PeriodSeconds(tf) * P_estVentana) / 60;
      Log(linea + "  -> cada vela = " + IntegerToString(PeriodSeconds(tf) / 60)
          + " min | caducidad W = " + IntegerToString(mCad)
          + " min | espera E = " + IntegerToString(mEr)
          + " min | ventana E = " + IntegerToString(mVen) + " min");
     }
  }

struct SecuenciaE
  {
   Toque  t1, t2, t3;
   int    nT;
   int    ciclo;
   bool   emitida;      // ya se entrego una entrada en este ciclo
   bool   impulso;
   int    impulsoBar;
   double impulsoOrigen;
   double impulsoExtremo;
   bool   tienePico;
   double pico;
   int    ultimaEntradaBar;
  };

struct Impulso
  {
   bool   ok;
   int    bar;
   double origen;
   double extremo;
  };

void NuevaSecuenciaE(SecuenciaE &s)
  {
   ZeroMemory(s);
   s.ultimaEntradaBar = -100000;
  }

bool HayToqueE(const SecuenciaE &s)
  {
   return s.nT > 0;
  }

Toque UltimoToqueE(const SecuenciaE &s)
  {
   if(s.nT == 3)
      return s.t3;
   if(s.nT == 2)
      return s.t2;
   if(s.nT == 1)
      return s.t1;
   Toque z;
   ZeroMemory(z);
   return z;
  }

void PushToqueE(SecuenciaE &s, const Toque &t)
  {
   if(s.nT < 3)
     {
      if(s.nT == 0)
         s.t1 = t;
      else if(s.nT == 1)
         s.t2 = t;
      else
         s.t3 = t;
      s.nT++;
      return;
     }
   s.t1 = s.t2;
   s.t2 = s.t3;
   s.t3 = t;
  }

Impulso DetectarImpulso(const MqlRates &r[], const int i, const bool venta, const double &atr[])
  {
   Impulso res;
   res.ok = false;
   res.bar = i;
   res.origen = 0;
   res.extremo = 0;
   double atrI = atr[i];
   if(!(atrI > 0))
      return res;
   int minVelas = MathMax(1, P_estMinVelasImpulso);
   int maxVelas = MathMax(minVelas, P_estMaxVelasImpulso);
   int ventana  = P_estVentana;
   if(i - ventana + 1 < 0)
      return res;
   for(int len = minVelas; len <= maxVelas; len++)
     {
      int inicio = i - len + 1;
      if(inicio < 0)
         break;
      double maxH = r[inicio].high, minL = r[inicio].low;
      for(int j = inicio + 1; j <= i; j++)
        {
         if(r[j].high > maxH)
            maxH = r[j].high;
         if(r[j].low < minL)
            minL = r[j].low;
        }
      double movimiento = maxH - minL;
      if(movimiento < P_estImpulsoMinAtr * atrI)
         continue;
      double bodySum = 0;
      for(int j = inicio; j <= i; j++)
         bodySum += MathAbs(r[j].close - r[j].open);
      double ratio = (movimiento > 0) ? bodySum / movimiento : 0;
      if(ratio < P_estCuerpoImpulso)
         continue;
      bool dirOk = venta ? (r[i].close < r[inicio].open) : (r[i].close > r[inicio].open);
      if(!dirOk)
         continue;
      double extremoVentana = venta ? 1.0e300 : -1.0e300;
      for(int j = i - ventana + 1; j <= i; j++)
         extremoVentana = venta ? MathMin(extremoVentana, r[j].low) : MathMax(extremoVentana, r[j].high);
      double extremo = venta ? minL : maxH;
      if(venta ? (extremo > extremoVentana) : (extremo < extremoVentana))
         continue;
      res.ok = true;
      res.bar = i;
      res.origen = venta ? maxH : minL;
      res.extremo = extremo;
      return res;
     }
   return res;
  }

void ProcesarBarraE(const MqlRates &r[], const int i, const bool venta,
                    const double &e30[], const double &e50[], const double &e100[],
                    const double &atr[], SecuenciaE &s, Evento &eventos[])
  {
   double atrI = atr[i];
   bool   actE = (i == g_barraActual);   // solo la vela cerrada mueve el embudo
   double cierre = r[i].close;
   double extremo = venta ? r[i].high : r[i].low;

   // 1. impulso nuevo solo si no hay uno vivo y paso el enfriamiento
   bool impulsoDetectado = false;
   if(!s.impulso && (i - s.ultimaEntradaBar) >= P_estEspera)
     {
      Impulso imp = DetectarImpulso(r, i, venta, atr);
      if(imp.ok)
        {
         if(actE)
            g_emb[g_tfIdx].imp++;
         s.impulso = true;
         s.impulsoBar = i;
         s.impulsoOrigen = imp.origen;
         s.impulsoExtremo = imp.extremo;
         s.tienePico = false;
         s.pico = 0;
         s.emitida = false;   // ciclo nuevo
         impulsoDetectado = true;
        }
     }
   if(!s.impulso)
      return;
   // la vela que forma el impulso no puede sembrar su propio retroceso
   if(impulsoDetectado)
      return;

   // 2. techo: si el cierre supera el origen del impulso, la pierna se rompio
   double margenTecho = 0.3 * atrI;
   bool sobreTecho = venta ? (cierre > s.impulsoOrigen + margenTecho)
                           : (cierre < s.impulsoOrigen - margenTecho);
   if(sobreTecho)
     {
      s.impulso = false;
      s.impulsoBar = -1;
      s.impulsoOrigen = 0;
      s.impulsoExtremo = 0;
      s.tienePico = false;
      s.nT = 0;
      s.ciclo = 0;
      s.emitida = false;
      return;
     }

   // 3. quiebre del nivel del ultimo toque, antes de actualizar la punta
   if(HayToqueE(s))
     {
      Toque t = UltimoToqueE(s);
      if(i > t.bar)
        {
         if((i - t.bar) > P_estCaducidad)
           {
            s.nT = 0;
            s.impulso = false;
            s.tienePico = false;
            s.emitida = false;
            return;
           }
         bool rompe = (t.nivel > 0) && (venta ? (cierre < t.nivel) : (cierre > t.nivel));
         if(rompe)
           {
            if(actE)
               g_emb[g_tfIdx].rompe++;
            string base = (s.nT >= 3) ? "3EB" : ((s.nT == 2) ? "2EB" : "1E");
            // §10: la pila solo exige ORDEN; la separacion solo se mide para el log.
            bool alineada = venta ? (cierre < e30[i] && e30[i] <= e50[i] && e50[i] <= e100[i])
                                  : (cierre > e30[i] && e30[i] >= e50[i] && e50[i] >= e100[i]);
            int crE = CrucesEma30(r, e30, i, P_ventanaCruces);
            double erE = ErDelTramo(r, s.impulsoBar, i, P_ventanaER);             double sep1E = venta ? (e50[i]-e30[i])/atr[i] : (e30[i]-e50[i])/atr[i];             double sep2E = venta ? (e100[i]-e50[i])/atr[i] : (e50[i]-e100[i])/atr[i];
            // la separacion solo se mide (va en el log): no filtra
            bool bloqueadoE = (crE >= P_minCrucesBloqueo) || (erE < P_erMinQuiebre);
            bool yaEmitidaE = P_unaPorSecuencia && s.emitida && (base != "1E");
            // reparto exacto: cada quiebre cae en una sola de estas ramas
            if(actE)
              {
               if(!alineada)                      g_emb[g_tfIdx].noAlinE++;
               else if(crE >= P_minCrucesBloqueo) g_emb[g_tfIdx].blqCruz++;
               else if(erE < P_erMinQuiebre)      g_emb[g_tfIdx].blqER++;
               else if(yaEmitidaE)                g_emb[g_tfIdx].yaLa++;
               else                               g_emb[g_tfIdx].emi++;
              }
            if(alineada && !bloqueadoE && !yaEmitidaE)
              {
               Emitir(eventos, i, venta, ConReset(base, s.ciclo), cierre, t.extremo, t.nivel,
                      e30[i], e50[i], e100[i], cierre);
               s.emitida = true;
               s.ciclo++;              // el reset solo avanza si de verdad hubo senal
               s.ultimaEntradaBar = i;
              }
            // antes se logueaba solo si la pila estaba alineada y se imprimian
            // los tres campos siempre, asi que no se sabia cual habia fallado.
            if(actE)
              {
               string motivoE = "";
               if(!alineada)                      motivoE += " pila-no-alineada";
               if(crE >= P_minCrucesBloqueo)      motivoE += " cruces=" + IntegerToString(crE);
               if(erE < P_erMinQuiebre)           motivoE += " ER=" + DoubleToString(erE,2);
               if(yaEmitidaE)                     motivoE += " ya-lanzada";
               if(StringLen(motivoE) > 0)
                  Log("[FILTRO] " + (venta?"VENTA":"COMPRA") + " Estructura quiebre " + g_tfTxt
                      + " bloqueado:" + motivoE + " (sep=" + DoubleToString(sep1E,2) + "/"
                      + DoubleToString(sep2E,2) + ")");
              }
            // Un quiebre bloqueado ya no tira la secuencia entera (Wonderizada
            // reintenta el toque siguiente): se descarta el toque y se deja
            // vivo el impulso, con su extremo, para que se forme otro retroceso.
            s.nT = 0;
            s.tienePico = false;
            return;
           }
        }
     }

   // 4. continuacion: punta nueva = la pierna sigue, no hay retroceso
   bool nuevaPunta = venta ? (r[i].low < s.impulsoExtremo) : (r[i].high > s.impulsoExtremo);
   if(nuevaPunta)
     {
      s.impulsoExtremo = venta ? r[i].low : r[i].high;
      s.impulsoBar = i;
      s.tienePico = false;
      return;
     }

   // 5. retroceso: se aleja de la punta sin superar el origen
   bool enRetroceso = venta ? (extremo > s.impulsoExtremo && extremo <= s.impulsoOrigen)
                            : (extremo < s.impulsoExtremo && extremo >= s.impulsoOrigen);
   if(enRetroceso)
     {
      if(!s.tienePico)
        {
         s.tienePico = true;
         s.pico = extremo;
        }
      else
         s.pico = venta ? MathMax(s.pico, extremo) : MathMin(s.pico, extremo);
     }

   // 6. fin del retroceso: primera vela que cierra en la direccion del impulso
   bool reversing = (i >= 1) && (venta ? (r[i].close < r[i-1].close) : (r[i].close > r[i-1].close));
   double retraccion = s.tienePico
                       ? (venta ? (s.pico - s.impulsoExtremo) : (s.impulsoExtremo - s.pico))
                       : 0;
   bool retroValido = (retraccion >= P_estRetrocesoMinAtr * atrI)
                      && (retraccion <= P_estRetrocesoMaxAtr * atrI);

   bool superaAnterior = true;
   if(HayToqueE(s))
     {
      Toque u = UltimoToqueE(s);
      superaAnterior = venta ? (s.pico > u.extremo) : (s.pico < u.extremo);
     }
   bool separado = true;
   if(HayToqueE(s))
     {
      Toque uSep = UltimoToqueE(s);
      separado = ((i - uSep.bar) >= P_separacionToques);
     }
   bool nuevoToque = s.tienePico && retroValido && reversing && separado && superaAnterior;

   if(nuevoToque)
     {
      if(actE)
         g_emb[g_tfIdx].toq++;
      double nivelQuiebre = s.impulsoExtremo;
      double contacto = s.pico;
      Toque nt;
      nt.bar = i;
      nt.nivel = nivelQuiebre;
      nt.extremo = contacto;
      nt.alto = contacto;
      nt.bajo = nivelQuiebre;
      PushToqueE(s, nt);
      s.tienePico = false;

      // la 2E y la 3E son avisos: solo salen con la pila alineada
      if(s.nT >= 2)
        {
         string codigo = (s.nT == 2) ? ConReset("2E", s.ciclo) : ConReset("3E", s.ciclo);
         // §10: la pila solo exige ORDEN; la separacion solo se mide para el log.
         bool alineada = venta ? (r[i].close < e30[i] && e30[i] <= e50[i] && e50[i] <= e100[i])
                               : (r[i].close > e30[i] && e30[i] >= e50[i] && e50[i] >= e100[i]);
         int crE2 = CrucesEma30(r, e30, i, P_ventanaCruces);          double erE2 = ErDelTramo(r, s.impulsoBar, i, P_ventanaER);          double sep1E2 = venta ? (e50[i]-e30[i])/atr[i] : (e30[i]-e50[i])/atr[i];          double sep2E2 = venta ? (e100[i]-e50[i])/atr[i] : (e50[i]-e100[i])/atr[i];
         // §2: el ER se mide y se escribe en el log, pero no bloquea.
         bool bloqueadoE2 = (crE2 >= P_minCrucesBloqueo);
         if(alineada && !bloqueadoE2)
           {
            Emitir(eventos, i, venta, codigo, r[i].close, contacto, nivelQuiebre,
                   e30[i], e50[i], e100[i], r[i].close);
            // NO se marca s.emitida: la 2E/3E es un aviso, no la entrada. Al
            // marcarla, P_unaPorSecuencia suprimia el 2EB/3EB (la entrada con
            // quiebre) de la misma secuencia y la jugada se quedaba sin salida.
           }
         if(bloqueadoE2 && alineada && i == g_barraActual)
            Log("[FILTRO] " + (venta?"VENTA":"COMPRA") + " Estructura toque " + g_tfTxt
                + " bloqueado: cruces=" + IntegerToString(crE2) + " ER=" + DoubleToString(erE2,2)
                + " sep=" + DoubleToString(sep1E2,2) + "/" + DoubleToString(sep2E2,2));
        }
     }
  }

void EscanearEstructura(const MqlRates &r[], Evento &eventos[])
  {
   ArrayResize(eventos, 0);
   int n = ArraySize(r);
   if(n < P_atrPeriodo + 5)
      return;
   g_barraActual = n - 1;   // solo la vela recien cerrada escribe log

   double cierres[];
   ArrayResize(cierres, n);
   for(int i=0; i<n; i++)
      cierres[i] = r[i].close;

   double e30[], e50[], e100[], atr[];
   CalcEma(cierres, P_emaContacto, e30);
   CalcEma(cierres, P_emaTecho, e50);
   CalcEma(cierres, P_emaFondo, e100);
   CalcAtr(r, P_atrPeriodo, atr);

   SecuenciaE venta, compra;
   NuevaSecuenciaE(venta);
   NuevaSecuenciaE(compra);

   for(int i = P_atrPeriodo; i < n; i++)
     {
      // las EMAs valen 0 hasta la vela 100: sin este guard la maquina de
      // estados arrancaba con EMA=0. Escanear ya lo comprobaba; este no.
      if(!(atr[i] > 0) || !(e30[i] > 0) || !(e50[i] > 0) || !(e100[i] > 0))
         continue;
      ProcesarBarraE(r, i, true,  e30, e50, e100, atr, venta,  eventos);
      ProcesarBarraE(r, i, false, e30, e50, e100, atr, compra, eventos);
     }
  }

//====================================================================
//  Tendencia mayor (port de serieEstructural + _tendenciaMayor)
//  Pivotes por CIERRE con k=5, confirmados k velas despues, y margen
//  0,25 ATR14 sobre el swing contrario.
//====================================================================
void SerieEstructural(const MqlRates &r[], const int kPivote, const double margenAtr,
                      int &dir[], double &invalida[])
  {
   int n = ArraySize(r);
   ArrayResize(dir, n);
   ArrayResize(invalida, n);
   ArrayInitialize(dir, 0);
   ArrayInitialize(invalida, 0.0);
   if(n < kPivote * 4 + 10)
      return;

   int altos[], bajos[];
   ArrayResize(altos, 0);
   ArrayResize(bajos, 0);
   for(int i = kPivote; i < n - kPivote; i++)
     {
      bool esAlto = true, esBajo = true;
      for(int m = 1; m <= kPivote; m++)
        {
         if(!(r[i].close > r[i-m].close && r[i].close > r[i+m].close))
            esAlto = false;
         if(!(r[i].close < r[i-m].close && r[i].close < r[i+m].close))
            esBajo = false;
         if(!esAlto && !esBajo)
            break;
        }
      if(esAlto)
        {
         int k = ArraySize(altos);
         ArrayResize(altos, k + 1);
         altos[k] = i;
        }
      if(esBajo)
        {
         int k = ArraySize(bajos);
         ArrayResize(bajos, k + 1);
         bajos[k] = i;
        }
     }

   double A[];
   CalcAtr(r, 14, A);

   int d = 0, ia = 0, ib = 0, ultimoAlto = -1, ultimoBajo = -1;
   int na = ArraySize(altos), nb = ArraySize(bajos);
   for(int i = 0; i < n; i++)
     {
      while(ia < na && altos[ia] + kPivote <= i)
        {
         ultimoAlto = altos[ia];
         ia++;
        }
      while(ib < nb && bajos[ib] + kPivote <= i)
        {
         ultimoBajo = bajos[ib];
         ib++;
        }
      double m = (margenAtr > 0 && A[i] > 0) ? margenAtr * A[i] : 0;
      if(ultimoAlto >= 0 && r[i].close > r[ultimoAlto].close + m && d != 1)
         d = 1;
      else if(ultimoBajo >= 0 && r[i].close < r[ultimoBajo].close - m && d != -1)
         d = -1;
      dir[i] = d;
      if(d == 1)
         invalida[i] = (ultimoBajo >= 0) ? r[ultimoBajo].close : 0;
      else if(d == -1)
         invalida[i] = (ultimoAlto >= 0) ? r[ultimoAlto].close : 0;
      else
         invalida[i] = 0;
     }
  }

struct TendMayor
  {
   bool     ok;
   string   tendencia;
   string   fase;
   double   invalida;
   datetime t;
   int      velasRotura;   // velas H1 desde la rotura que sostiene la direccion
  };

TendMayor TendenciaMayor(const string simbolo, const datetime tCierre)
  {
   TendMayor tm;
   tm.ok = false;
   tm.tendencia = "";
   tm.fase = "";
   tm.invalida = 0;
   tm.t = 0;
   tm.velasRotura = 0;

   MqlRates h1[];
   int n = CopyRates(simbolo, PERIOD_H1, 1, 1500, h1);
   if(n < P_emaFondo + 5)
      return tm;

   // ultima vela H1 cuyo cierre ya ocurrio cuando se emitio la senal
   int k = -1;
   for(int i = n - 1; i >= 0; i--)
     {
      if((long)h1[i].time + 3600 <= (long)tCierre)
        {
         k = i;
         break;
        }
     }
   if(k < P_emaFondo)
      return tm;

   int dir[];
   double inv[];
   SerieEstructural(h1, 5, 0.25, dir, inv);

   double cierres[];
   ArrayResize(cierres, n);
   for(int i = 0; i < n; i++)
      cierres[i] = h1[i].close;
   double e30[];
   CalcEma(cierres, P_emaContacto, e30);

   int d = dir[k];
   tm.ok = true;
   tm.t = h1[k].time;
   // antiguedad de la rotura: si la direccion lleva cientos de velas H1 sin
   // renovarse, la etiqueta describe el pasado, no la estructura de ahora.
   int vr = 0;
   if(d != 0)
      for(int j = k; j >= 0; j--)
        {
         if(dir[j] != d)
            break;
         vr = k - j;
        }
   tm.velasRotura = vr;
   tm.invalida = inv[k];
   tm.tendencia = (d == 1) ? "ALCISTA" : ((d == -1) ? "BAJISTA" : "RANGO");
   bool enTendencia = false;
   if(d == 1)
      enTendencia = (h1[k].close >= e30[k]);
   else if(d == -1)
      enTendencia = (h1[k].close <= e30[k]);
   tm.fase = (d == 0) ? "RANGO" : (enTendencia ? "TENDENCIA" : "RETROCESO");
   return tm;
  }

string SufijoTendencia(const TendMayor &tm, const string tfZona)
  {   if(!tm.ok || tfZona == "H1")
      return "";
   string fase = (tm.fase == "TENDENCIA") ? "en tendencia"
                 : ((tm.fase == "RETROCESO") ? "retroceso" : "sin swing");
   return " · H1 " + tm.tendencia + " · " + fase;
  }

// Resumen de una linea del estado H1, para el latido.
string EstadoH1(const string simbolo)
  {
   TendMayor tm = TendenciaMayor(simbolo, TimeGMT());
   if(!tm.ok)
      return "";
   return tm.tendencia + " · " + tm.fase + " · rotura hace "
          + IntegerToString(tm.velasRotura) + " velas H1";
  }

//====================================================================
//  Prioridad cuando el mismo lado da dos codigos en la misma vela
//  (port de prioridadEvento: entrada > aviso y tier A > B > C)
//====================================================================
// OJO con las dos escalas: 2E/3E devuelven 5/6 y el resto 100+tier*10+rr.
// No es un error: las dos estrategias nunca tienen el mismo patron, asi que
// el empate es imposible. La escala baja es intencional (aviso < entrada) y
// el hueco solo hace obvio que un aviso pierde contra cualquier entrada.
//--------------------------------------------------------------------
//  Prioridad: que gana cuando dos patrones caen en la MISMA vela y el
//  MISMO lado (ADVERSARIO.md §8). Es un orden TOTAL: no hay dos codigos
//  con el mismo rango, asi que el empate es imposible por construccion y
//  no depende del orden en que se lleno el array de candidatos.
//
//  Criterio, de mas a menos, y el por que:
//   1. la SEDUCTORA (1S) manda: su stop es la punta del tramo, un precio
//      fijo, y no depende de donde este la escalera en ese momento.
//   2. la ROTURA CON CUERPO (B), y dentro de ella la mas avanzada
//      (3B > 2B > 1B): cada B exige que la tendencia rompiera otra punta.
//   3. el TOQUE de la escalera, y dentro de el el mas temprano
//      (1 > 2 > 3): el 1 es el toque fresco; el 3 llega con el tramo ya
//      maduro, que es por lo que la escalera se corta en 3.
//   4. detras de un reset (R) por delante de la original del mismo codigo:
//      esa escalera ya sobrevivio a un engano.
//   5. la familia ESTRUCTURA por detras de la Wonderizada: cuando las dos
//      ven la misma jugada manda la regla madre (§1).
//   6. los avisos de estructura, por debajo de toda entrada.
//
//  Para cambiar el orden basta mover un numero de la tabla.
//--------------------------------------------------------------------
int Prioridad(const string p)
  {
   // 6. avisos: no son entradas
   if(p == "3RE" || p == "3E") return 6;
   if(p == "2RE" || p == "2E") return 5;

   int rank = 0;
   // 1. la seductora
   if     (p == "1SR") rank = 20;
   else if(p == "1S")  rank = 19;
   // 2. la rotura con cuerpo
   else if(p == "3RB") rank = 18;
   else if(p == "3B")  rank = 17;
   else if(p == "2RB") rank = 16;
   else if(p == "2B")  rank = 15;
   else if(p == "1RB") rank = 14;
   else if(p == "1B")  rank = 13;
   // 3. el toque de la escalera
   else if(p == "1R")  rank = 12;
   else if(p == "1")   rank = 11;
   else if(p == "2R")  rank = 10;
   else if(p == "2")   rank = 9;
   else if(p == "3R")  rank = 8;
   else if(p == "3")   rank = 7;
   // 4. familia estructura
   else if(p == "3REB") rank = 6;
   else if(p == "3EB")  rank = 5;
   else if(p == "2REB") rank = 4;
   else if(p == "2EB")  rank = 3;
   else if(p == "1RE")  rank = 2;
   else if(p == "1E")   rank = 1;
   else
      return 0;

   return 100 + rank;
  }
