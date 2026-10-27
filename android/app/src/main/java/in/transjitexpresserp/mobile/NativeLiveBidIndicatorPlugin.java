package in.transjitexpresserp.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Isolated native status notification for stored Live transport bids. It never
 * performs network I/O, FCM handling, token registration, or background work.
 */
@CapacitorPlugin(name = "NativeLiveBidIndicator")
public class NativeLiveBidIndicatorPlugin extends Plugin {
    private static final String CHANNEL_ID = "transjit_live_bid_status_v2";
    private static final String CHANNEL_NAME = "Live Bid Status";
    private static final String NOTIFICATION_TAG = "transjit_live_bid_indicator_v1";
    private static final int NOTIFICATION_ID = 730001;
    private static final String ACTION_OPEN_LIVE_BIDS =
        "in.transjitexpresserp.mobile.action.OPEN_LIVE_BIDS";

    private boolean pendingOpen = false;

    @PluginMethod
    public void sync(PluginCall call) {
        Integer countValue = call.getInt("count");
        int count = countValue == null ? 0 : countValue;
        if (count <= 0) {
            cancelIndicator();
            call.resolve();
            return;
        }

        String deadlineState = call.getString("deadlineState", "none");
        String label = safeLabel(call.getString("label"));
        Long closesAtEpochMs = call.getLong("closesAtEpochMs");
        boolean hasFutureDeadline = "future".equals(deadlineState)
            && closesAtEpochMs != null
            && closesAtEpochMs > System.currentTimeMillis();

        ensureChannel();
        Bitmap largeIcon = BitmapFactory.decodeResource(getContext().getResources(), R.mipmap.transjit_logo);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_transjit_notification)
            .setLargeIcon(largeIcon)
            .setContentTitle(titleFor(count, label))
            .setContentText(bodyFor(count, label, deadlineState))
            .setContentIntent(openLiveBidsIntent())
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(false);

        if (hasFutureDeadline) {
            builder
                .setWhen(closesAtEpochMs)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true);
        } else {
            // Never turn a passed deadline into an elapsed/up-counting timer.
            builder.setShowWhen(false);
        }

        NotificationManagerCompat.from(getContext()).notify(NOTIFICATION_TAG, NOTIFICATION_ID, builder.build());
        call.resolve();
    }

    @PluginMethod
    public void consumePendingOpen(PluginCall call) {
        JSObject result = new JSObject();
        result.put("open", pendingOpen);
        pendingOpen = false;
        call.resolve(result);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && ACTION_OPEN_LIVE_BIDS.equals(intent.getAction())) {
            pendingOpen = true;
            notifyListeners("openLiveBids", new JSObject());
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Persistent status for active Transjit Live Bids.");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    private PendingIntent openLiveBidsIntent() {
        Intent intent = new Intent(getContext(), getActivity().getClass())
            .setAction(ACTION_OPEN_LIVE_BIDS)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            getContext(),
            NOTIFICATION_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void cancelIndicator() {
        NotificationManagerCompat.from(getContext()).cancel(NOTIFICATION_TAG, NOTIFICATION_ID);
    }

    private String titleFor(int count, String label) {
        if (count == 1) return "LIVE BID — " + (label == null ? "Bid" : label);
        return count + " LIVE BIDS";
    }

    private String bodyFor(int count, String label, String deadlineState) {
        if ("future".equals(deadlineState)) {
            return count == 1 ? "⏱ ENDS IN" : "Next closing: " + (label == null ? "Live Bid" : label);
        }
        if ("passed".equals(deadlineState)) {
            return "Closing time passed — Bid still LIVE";
        }
        return "Live — No closing time set";
    }

    private String safeLabel(String value) {
        if (value == null) return null;
        String label = value.replaceAll("[\\r\\n\\t]+", " ").trim();
        if (label.isEmpty()) return null;
        return label.length() <= 80 ? label : label.substring(0, 80);
    }
}
