/* Script Ghidra: radiografia del instalador MT5 — hallazgos reales */
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.mem.*;
import java.util.*;
import java.util.regex.*;

public class RadiografiaMT5Setup extends GhidraScript {
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
        println("=== RADIOGRAFIA Ghidra: " + currentProgram.getName() + " ===");
        println("Imagen base: " + currentProgram.getImageBase());
        println("Funciones identificadas: " + currentProgram.getFunctionManager().getFunctionCount());
        for (Address a : currentProgram.getSymbolTable().getExternalEntryPointIterator())
            println("  entry: " + a);

        println("Constantes criptograficas:");
        buscar(SBOX_AES, "S-box AES");
        buscar(SHA256_H0, "IV SHA-256");
        buscar("EX5".getBytes("UTF-8"), "EX5");
        buscar(".mq5".getBytes("UTF-8"), ".mq5");

        println("Cadenas ASCII largas (primeras 40):");
        Memory mem = currentProgram.getMemory();
        int cont = 0;
        for (MemoryBlock blk : mem.getBlocks()) {
            if (cont >= 40) break;
            if (!blk.isInitialized()) { println("  [bloque no inicializado: " + blk.getName() + "]"); continue; }
            try {
                byte[] datos = new byte[(int)blk.getSize()];
                blk.getBytes(blk.getStart(), datos);
                Matcher m = Pattern.compile("[\\x20-\\x7e]{10,}").matcher(new String(datos, java.nio.charset.StandardCharsets.ISO_8859_1));
                while (m.find() && cont < 40) {
                    String g = m.group();
                    println("  " + blk.getStart().add(m.start()) + " (" + blk.getName() + "): \"" + g.substring(0, Math.min(90, g.length())) + "\"");
                    cont++;
                }
            } catch (Exception e) { println("  [error en bloque " + blk.getName() + ": " + e.getMessage() + "]"); }
        }
        println("=== FIN ===");
    }
}
