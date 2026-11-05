import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

public class DecompilarMuestra extends GhidraScript {
    @Override
    public void run() throws Exception {
        DecompInterface di = new DecompInterface();
        di.openProgram(currentProgram);
        int n = 0;
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        while (it.hasNext() && n < 5) {
            Function f = it.next();
            println("//=== " + f.getName() + " (0x" + f.getEntryPoint() + ") ===");
            DecompileResults r = di.decompileFunction(f, 30, monitor);
            if (r != null && r.decompileCompleted() && r.getDecompiledFunction() != null) {
                println(r.getDecompiledFunction().getC());
            } else {
                println("// descompilacion fallo");
            }
            n++;
        }
        di.dispose();
        println("TOTAL_FUNCIONES=" + currentProgram.getFunctionManager().getFunctionCount());
    }
}
