package in.transjitexpresserp.mobile;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.util.List;

/**
 * Private-test bridge for sharing generated PDFs through a scoped MediaStore
 * document URI. Android 10+ needs no broad storage permission for items owned
 * by this app. The PDF remains available for 24 hours so receiving apps can
 * finish any asynchronous preview work after the chooser returns.
 */
@CapacitorPlugin(name = "NativeMediaStorePdfShare")
public class NativeMediaStorePdfSharePlugin extends Plugin {
    private static final String MIME_TYPE = "application/pdf";
    private static final String RELATIVE_PATH = "Download/Transjit Express ERP/Temporary Shares/";
    private static final long CLEANUP_DELAY_MS = 24L * 60L * 60L * 1000L;

    @PluginMethod
    public void sharePdf(PluginCall call) {
        JSObject result = new JSObject();
        result.put("shared", false);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.resolve(result);
            return;
        }

        String encodedPdf = call.getString("base64");
        String filename = safeFilename(call.getString("filename"));
        if (encodedPdf == null || filename == null) {
            call.reject("A PDF and filename are required for native sharing.");
            return;
        }

        try {
            ContentResolver resolver = getContext().getContentResolver();
            cleanupExpiredDocuments(resolver);

            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
            values.put(MediaStore.MediaColumns.MIME_TYPE, MIME_TYPE);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, RELATIVE_PATH);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);

            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("Unable to create a shareable PDF document.");
                return;
            }

            try {
                byte[] pdfBytes = Base64.decode(encodedPdf, Base64.DEFAULT);
                try (OutputStream output = resolver.openOutputStream(uri, "w")) {
                    if (output == null) throw new IllegalStateException("Unable to write the PDF document.");
                    output.write(pdfBytes);
                }
                ContentValues published = new ContentValues();
                published.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(uri, published, null, null);
            } catch (Exception error) {
                resolver.delete(uri, null, null);
                throw error;
            }

            shareUri(uri, call);
            scheduleCleanup(uri);
            result.put("shared", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to share the PDF document.", error);
        }
    }

    private void shareUri(Uri uri, PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_SEND);
        intent.setType(MIME_TYPE);
        intent.putExtra(Intent.EXTRA_STREAM, uri);
        intent.setClipData(ClipData.newRawUri("shared-pdf", uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        List<ResolveInfo> targets = getContext().getPackageManager()
            .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo target : targets) {
            getContext().grantUriPermission(target.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }

        String dialogTitle = call.getString("dialogTitle", "Share PDF");
        getActivity().startActivity(Intent.createChooser(intent, dialogTitle));
    }

    private void scheduleCleanup(Uri uri) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                getContext().getContentResolver().delete(uri, null, null);
            } catch (Exception ignored) {
                // Best-effort cleanup must never affect document sharing.
            }
        }, CLEANUP_DELAY_MS);
    }

    private void cleanupExpiredDocuments(ContentResolver resolver) {
        long cutoffSeconds = (System.currentTimeMillis() - CLEANUP_DELAY_MS) / 1000L;
        String selection = MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND "
            + MediaStore.MediaColumns.DATE_ADDED + " < ?";
        try {
            resolver.delete(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                selection,
                new String[] { RELATIVE_PATH, String.valueOf(cutoffSeconds) }
            );
        } catch (Exception ignored) {
            // A stale private-test document is never a reason to block sharing.
        }
    }

    private String safeFilename(String filename) {
        if (filename == null) return null;
        String value = filename.replace("/", "-").replace("\\", "-").trim();
        if (value.isEmpty() || !value.toLowerCase().endsWith(".pdf")) return null;
        return value;
    }
}
