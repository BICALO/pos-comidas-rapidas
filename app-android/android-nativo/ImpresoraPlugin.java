package __PAQUETE__;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Plugin propio de la app (no requiere instalar nada extra):
 *  - imprimir({ html, nombre }): manda el comprobante al servicio de impresion
 *    de Android (impresoras WiFi/Bluetooth instaladas o "Guardar como PDF").
 *  - guardarArchivo({ nombre, contenido, tipo }): guarda un respaldo en
 *    Descargas/POS Comidas Rapidas.
 */
@CapacitorPlugin(name = "Impresora")
public class ImpresoraPlugin extends Plugin {

    // Se guarda la referencia mientras Android prepara la impresion
    private WebView webViewImpresion;

    @PluginMethod
    public void imprimir(final PluginCall call) {
        final String html = call.getString("html", "");
        final String nombre = call.getString("nombre", "Comprobante");
        getActivity().runOnUiThread(() -> {
            try {
                WebView wv = new WebView(getActivity());
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        try {
                            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                            PrintDocumentAdapter adaptador = view.createPrintDocumentAdapter(nombre);
                            pm.print(nombre, adaptador, new PrintAttributes.Builder().build());
                            call.resolve();
                        } catch (Exception e) {
                            call.reject("No se pudo abrir la impresion: " + e.getMessage());
                        }
                    }
                });
                wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                webViewImpresion = wv;
            } catch (Exception e) {
                call.reject("No se pudo preparar la impresion: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void guardarArchivo(PluginCall call) {
        String nombre = call.getString("nombre", "respaldo-pos.json");
        String contenido = call.getString("contenido", "");
        String tipo = call.getString("tipo", "application/json");
        try {
            byte[] bytes = contenido.getBytes(StandardCharsets.UTF_8);
            String ruta;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, nombre);
                v.put(MediaStore.MediaColumns.MIME_TYPE, tipo);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/POS Comidas Rapidas");
                ContentResolver cr = getContext().getContentResolver();
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("Android no permitio crear el archivo");
                try (OutputStream os = cr.openOutputStream(uri)) {
                    if (os == null) throw new Exception("No se pudo abrir el archivo");
                    os.write(bytes);
                }
                ruta = "Descargas/POS Comidas Rapidas/" + nombre;
            } else {
                File dir = new File(getContext().getExternalFilesDir(null), "respaldos");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("No se pudo crear la carpeta");
                File f = new File(dir, nombre);
                try (FileOutputStream os = new FileOutputStream(f)) {
                    os.write(bytes);
                }
                ruta = f.getAbsolutePath();
            }
            JSObject r = new JSObject();
            r.put("ruta", ruta);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudo guardar el archivo: " + e.getMessage());
        }
    }
}
