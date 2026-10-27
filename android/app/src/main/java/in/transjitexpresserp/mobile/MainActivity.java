package in.transjitexpresserp.mobile;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private FloatingShortcutController floatingShortcutControls;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeNotificationSettingsPlugin.class);
        registerPlugin(NativeMediaStorePdfSharePlugin.class);
        registerPlugin(NativeLiveBidIndicatorPlugin.class);
        super.onCreate(savedInstanceState);
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
