package in.transjitexpresserp.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Must match PO_ALERTS_CHANNEL_ID in supabase/functions/process-notifications. */
    static final String PO_ALERTS_CHANNEL_ID = "transjit_po_alerts_v1";

    private FloatingShortcutController floatingShortcutControls;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeNotificationSettingsPlugin.class);
        registerPlugin(NativeMediaStorePdfSharePlugin.class);
        registerPlugin(NativeLiveBidIndicatorPlugin.class);
        super.onCreate(savedInstanceState);
        createPoAlertsChannel();
        if (bridge != null) {
            floatingShortcutControls = FloatingShortcutController.attach(this, bridge.getWebView());
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                    return;
                }

                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }

    /**
     * PO usage alarms (80/90/95/100%) play the Urgent beeps tone. Created natively so
     * the channel can only ever exist with the sound bundled in this APK (a channel's
     * sound cannot change after creation). Safe to call on every start.
     */
    private void createPoAlertsChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
            PO_ALERTS_CHANNEL_ID,
            "PO usage alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Alerts when a purchase order reaches 80%, 90%, 95% or 100% of its allotted weight.");
        Uri sound = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.transjit_po_urgent_beeps);
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(sound, attributes);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] {0, 120, 60, 120, 60, 120, 270, 120, 60, 120, 60, 120});
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onStart() {
        super.onStart();
        FloatingShortcutService.setErpVisible(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (floatingShortcutControls != null) floatingShortcutControls.onResume();
    }

    @Override
    public void onPause() {
        if (floatingShortcutControls != null) floatingShortcutControls.onPause();
        super.onPause();
    }

    @Override
    public void onStop() {
        FloatingShortcutService.setErpVisible(false);
        super.onStop();
    }

    @Override
    public void onDestroy() {
        if (floatingShortcutControls != null) floatingShortcutControls.destroy();
        super.onDestroy();
    }
}
