package app.prevenza.scamguard;

import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * "Share to Prevenza". Holds ONE shared item in memory until the page asks for it, then forgets it.
 * Nothing is written to disk, logged or sent anywhere. The page only puts the item into a checker's input box.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    private static final int MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_TEXT_CHARS = 20000;

    private static String pendingText = null;
    private static Uri pendingImage = null;
    private static String pendingImageType = null;
    private static ShareTargetPlugin live = null;

    @Override
    public void load() {
        live = this;
    }

    /** Called by MainActivity for every incoming intent. Only ACTION_SEND text and images are accepted. */
    static synchronized void accept(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        if (type == null) return;
        if (type.startsWith("text/")) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text == null) return;
            String s = text.toString();
            pendingText = s.length() > MAX_TEXT_CHARS ? s.substring(0, MAX_TEXT_CHARS) : s;
            pendingImage = null;
            pendingImageType = null;
        } else if (type.startsWith("image/")) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) return;
            pendingImage = uri;
            pendingImageType = type;
            pendingText = null;
        } else {
            return;
        }
        // The shared item has been taken from the intent; make sure it is not handled twice.
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_STREAM);
        if (live != null) live.notifyListeners("shareReceived", new JSObject());
    }

    @PluginMethod
    public void getShared(PluginCall call) {
        JSObject out = new JSObject();
        String text;
        Uri image;
        String imageType;
        synchronized (ShareTargetPlugin.class) {
            text = pendingText;
            image = pendingImage;
            imageType = pendingImageType;
            pendingText = null;
            pendingImage = null;
            pendingImageType = null;
        }
        if (text != null) {
            out.put("kind", "text");
            out.put("text", text);
        } else if (image != null) {
            if (!"image/png".equals(imageType) && !"image/jpeg".equals(imageType)) {
                out.put("kind", "unsupported");
            } else {
                try {
                    byte[] bytes = readLimited(image);
                    if (bytes == null) {
                        out.put("kind", "too-large");
                    } else {
                        out.put("kind", "image");
                        out.put("mime", imageType);
                        out.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    }
                } catch (Exception e) {
                    out.put("kind", "none");
                }
            }
        } else {
            out.put("kind", "none");
        }
        call.resolve(out);
    }

    /** Reads the image into memory, or returns null if it is over the 8 MB limit. */
    private byte[] readLimited(Uri uri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return new byte[0];
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int total = 0;
            int n;
            while ((n = in.read(chunk)) != -1) {
                total += n;
                if (total > MAX_IMAGE_BYTES) return null;
                buffer.write(chunk, 0, n);
            }
            return buffer.toByteArray();
        }
    }
}
