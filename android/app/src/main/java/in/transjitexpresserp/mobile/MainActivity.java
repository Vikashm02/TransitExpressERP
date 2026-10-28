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
    /** Channel IDs must match the *_ANDROID_CHANNEL constants in supabase/functions/process-notifications. */
    static final String PO_ALERTS_CHANNEL_ID = "transjit_po_alerts_v1";
    static final String DC_CREATED_CHANNEL_ID = "transjit_dc_created_v1";
    static final String POD_CREATED_CHANNEL_ID = "transjit_pod_created_v1";

    private FloatingShortcutController floatingShortcutControls;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeNotificationSettingsPlugin.class);
        registerPlugin(NativeMediaStorePdfSharePlugin.class);
        registerPlugin(NativeLiveBidIndicatorPlugin.class);
        super.onCreate(savedInstanceState);
        createModuleAlertChannels();
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
     * Per-module alert tones. Created natively so a channel can only ever exist with
     * the sound bundled in this APK (a channel's sound cannot change after creation).
     * Safe to call on every start. All other alerts use transjit_erp_alerts_v1 (koyal).
     */
    private void createModuleAlertChannels() {
        // PO usage alarms (80/90/95/100%): Urgent beeps.
        createAlertChannel(
            PO_ALERTS_CHANNEL_ID,
            "PO usage alerts",
            "Alerts when a purchase order reaches 80%, 90%, 95% or 100% of its allotted weight.",
            R.raw.transjit_po_urgent_beeps,
            new long[] {0, 120, 60, 120, 60, 120, 270, 120, 60, 120, 60, 120}
        );
        // New Delivery Challan: Bubble pop.
        createAlertChannel(
            DC_CREATED_CHANNEL_ID,
            "Delivery Challan created",
            "Alerts when a new Delivery Challan is created.",
            R.raw.transjit_dc_bubble_pop,
            new long[] {0, 80}
        );
        // New POD: same Bubble pop tone, own channel so it can be adjusted separately.
        createAlertChannel(
            POD_CREATED_CHANNEL_ID,
            "POD created",
            "Alerts when a new Proof of Delivery is created.",
            R.raw.transjit_dc_bubble_pop,
            new long[] {0, 80}
        );
    }

    private void createAlertChannel(String id, String name, String description, int soundRes, long[] vibration) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        Uri sound = Uri.parse("android.resource://" + getPackageName() + "/" + soundRes);
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(sound, attributes);
        channel.enableVibration(true);
        channel.setVibrationPattern(vibration);
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
