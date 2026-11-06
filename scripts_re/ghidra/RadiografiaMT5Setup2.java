/* Script Ghidra v2: radiografía del instalador MT5 sin auto-análisis
   (bajo consumo de memoria; hallazgos por escaneo de memoria).
   Uso: analyzeHeadless ... -import mt5setup.exe -noanalysis
        -scriptPath scripts_re/ghidra -postScript RadiografiaMT5Setup2.java */
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import java.util.*;
import java.util.regex.*;

public class RadiografiaMT5Setup2 extends GhidraScript {
    final byte[] SBOX_AES = {
        (byte)0x63,(byte)0x7c,(byte)0x77,(byte)0x7b,(byte)0xf2,(byte)0x6b,(byte)0x6f,(byte)0xc5,
        (byte)0x30,(byte)0x01,(byte)0x67,(byte)0x2b,(byte)0xfe,(byte)0xd7,(byte)0xab,(byte)0x76 };
    final byte[] SHA256_H0 = {
        (byte)0x6a,(byte)0x09,(byte)0xe6,(byte)0x67,(byte)0xbb,(byte)0x67,(byte)0xae,(byte)0x85 };

    void buscar(byte[] aguja, String nombre) throws Exception {
        Memory mem = currentProgram.getMemory();
        Address found = mem.findBytes(currentProgram.getMinAddress(), aguja, null, true, monitor);
        int n = 0;
        while (found != null && n < 8) {
            println("  [" + nombre + "] @ " + found);
            found = mem.findBytes(found.add(1), aguja, null, true, monitor);
            n++;
        }
        if (n == 0) println("  [" + nombre + "] no encontrado");
    }

    public void run() throws Exception {
        println("=== RADIOGRAFIA v2 (sin auto-analisis): " + currentProgram.getName() + " ===");
        println("Imagen base: " + currentProgram.getImageBase());

        println("Tabla de secciones:");
        Memory mem = currentProgram.getMemory();
        for (MemoryBlock blk : mem.getBlocks()) {
            println(String.format("  %-10s virtual=0x%x (%.1f MB) initialized=%s exec=%s",
                blk.getName(), blk.getSize(), blk.getSize() / 1048576.0, blk.isInitialized(), blk.isExecute()));
        }

        println("Puntos de entrada externos:");
        for (Address a : currentProgram.getSymbolTable().getExternalEntryPointIterator())
            println("  entry: " + a);

        println("Constantes criptograficas:");
        buscar(SBOX_AES, "S-box AES");
        buscar(SHA256_H0, "IV SHA-256");
        buscar("EX5".getBytes("UTF-8"), "EX5");
        buscar(".mq5".getBytes("UTF-8"), ".mq5");
        buscar("terminal64".getBytes("UTF-8"), "terminal64");

        println("Tabla de nombres de API en .cod2 (clara):");
        MemoryBlock cod2 = mem.getBlock(".cod2");
        if (cod2 != null && cod2.isInitialized()) {
            byte[] datos = new byte[(int)Math.min(cod2.getSize(), 64L * 1024 * 1024)];
            cod2.getBytes(cod2.getStart(), datos);
            Matcher m = Pattern.compile("[\\x20-\\x7e]{8,}").matcher(new String(datos, java.nio.charset.StandardCharsets.ISO_8859_1));
            int cont = 0;
            Set<String> interes = new HashSet<>(Arrays.asList(
                "InitCommonControlsEx", "DeviceIoControl", "CRYPT32", "ADVAPI32", "CreateWindowExW",
                "SetNamedSecurityInfoW", "CryptDecrypt", "CryptImportKey", "BCryptDecrypt", "VirtualAlloc",
                "WinVerifyTrust", "CryptQueryObject", "WinHttp", "InternetOpen"));
            Set<String> vistas = new HashSet<>();
            while (m.find() && cont < 40) {
                String g = m.group();
                if (vistas.contains(g)) continue;
                vistas.add(g);
                boolean marcada = false;
                for (String s : interes) if (g.contains(s)) { marcada = true; break; }
                if (marcada || cont < 25) println("  " + cod2.getStart().add(m.start()) + ": \"" + g.substring(0, Math.min(70, g.length())) + "\"" + (marcada ? "  <-- clave" : ""));
                cont++;
            }
        } else {
            println("  [.cod2 no inicializada o ausente]");
        }
        println("=== FIN ===");
    }
}
