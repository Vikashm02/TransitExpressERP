package in.transjitexpresserp.mobile;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.widget.PopupMenu;
import androidx.appcompat.widget.TooltipCompat;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/** Device-only controls: no JavaScript bridge, remote routes, or persisted start commands. */
final class FloatingShortcutController {
    private static final String TAG = "ErpShortcutControls";
    private final MainActivity activity;
    private final View webView;
    private final CoordinatorLayout root;
    private final View control;
    private final int originalBottomMargin;
    private final Runnable stateListener = this::refresh;
    private AlertDialog controlsDialog;
    private AlertDialog permissionDialog;
    private PopupMenu menu;
    private boolean resumed;
    private boolean available = true;

    /** Unsupported containers are an optional-feature limitation, not an ERP startup failure. */
    static FloatingShortcutController attach(MainActivity activity, View webView) {
        if (webView == null || !(webView.getParent() instanceof CoordinatorLayout)
            || !(webView.getLayoutParams() instanceof CoordinatorLayout.LayoutParams)) {
            Log.w(TAG, "Shortcut controls unavailable: unsupported WebView parent or layout parameters");
            return null;
        }
        return new FloatingShortcutController(activity, webView, (CoordinatorLayout) webView.getParent());
    }

    private FloatingShortcutController(MainActivity activity, View webView, CoordinatorLayout root) {
        this.activity = activity;
        this.webView = webView;
        this.root = root;
        originalBottomMargin = ((CoordinatorLayout.LayoutParams) webView.getLayoutParams()).bottomMargin;
        // A single overflow button, outside the page bounds. Capacitor still owns the root/WebView.
        control = activity.getLayoutInflater().inflate(R.layout.floating_shortcut_controls, root, false);
        CoordinatorLayout.LayoutParams params = new CoordinatorLayout.LayoutParams(
            control.getLayoutParams().width, control.getLayoutParams().height);
        params.gravity = Gravity.BOTTOM | Gravity.END;
        root.addView(control, params);
        TooltipCompat.setTooltipText(control, activity.getString(R.string.shortcut_controls));
        control.setOnClickListener(view -> showMenu());
        control.addOnLayoutChangeListener((view, l, t, r, b, oldL, oldT, oldR, oldB) -> reserveSpace());
        ViewCompat.setOnApplyWindowInsetsListener(control, (view, insets) -> {
            if (!checkLayout()) return insets;
            Insets safe = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout());
            CoordinatorLayout.LayoutParams layout = (CoordinatorLayout.LayoutParams) control.getLayoutParams();
            if (layout.leftMargin != safe.left || layout.rightMargin != safe.right || layout.bottomMargin != safe.bottom) {
                layout.leftMargin = safe.left;
                layout.rightMargin = safe.right;
                layout.bottomMargin = safe.bottom;
                control.setLayoutParams(layout);
            }
            // Leave all keyboard space to the ERP form; controls return when the IME closes.
            view.setVisibility(insets.isVisible(WindowInsetsCompat.Type.ime()) ? View.GONE : View.VISIBLE);
            reserveSpace();
            return insets;
        });
        FloatingShortcutService.addStateListener(stateListener);
        ViewCompat.requestApplyInsets(control);
        refresh();
    }

    private boolean checkLayout() {
        if (!available) return false;
        if (webView.getParent() != root || !(webView.getLayoutParams() instanceof CoordinatorLayout.LayoutParams)
            || control.getParent() != root || !(control.getLayoutParams() instanceof CoordinatorLayout.LayoutParams)) {
            Log.w(TAG, "Shortcut controls disabled: WebView container or layout parameters changed");
            destroy();
            return false;
        }
        return true;
    }

    private void reserveSpace() {
        if (!checkLayout()) return;
        CoordinatorLayout.LayoutParams params = (CoordinatorLayout.LayoutParams) webView.getLayoutParams();
        CoordinatorLayout.LayoutParams controlParams = (CoordinatorLayout.LayoutParams) control.getLayoutParams();
        int bottom = originalBottomMargin + (control.getVisibility() == View.VISIBLE
            ? control.getHeight() + controlParams.bottomMargin : 0);
        if (params.bottomMargin != bottom) {
            params.bottomMargin = bottom;
            webView.setLayoutParams(params);
        }
    }

    void onResume() {
        resumed = true;
        FloatingShortcutService.checkPermission();
        if (!checkLayout()) return;
        refresh();
    }

    void onPause() {
        resumed = false;
        dismissMenus();
    }

    private String statusText() {
        if (FloatingShortcutService.isRunning()) return activity.getString(R.string.shortcut_state_on);
        return activity.getString(FloatingShortcutService.isRequested(activity)
            ? R.string.shortcut_state_used_before : R.string.shortcut_state_off);
    }

    private String dialogText() {
        return activity.getString(R.string.shortcut_explanation) + "\n\n" + statusText();
    }

    private void refresh() {
        if (!available) return;
        if (controlsDialog != null && controlsDialog.isShowing()) {
            controlsDialog.setMessage(dialogText());
            controlsDialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(!FloatingShortcutService.isRunning());
        }
    }

    private void showMenu() {
        if (!resumed || !checkLayout()) return;
        menu = new PopupMenu(activity, control);
        menu.getMenu().add(R.string.shortcut_title).setOnMenuItemClickListener(item -> {
            showControls();
            return true;
        });
        menu.show();
    }

    private void showControls() {
        if (!resumed || !checkLayout()) return;
        controlsDialog = new AlertDialog.Builder(activity)
            .setTitle(R.string.shortcut_title)
            .setMessage(dialogText())
            .setPositiveButton(R.string.shortcut_start, (d, which) -> requestStart())
            .setNegativeButton(R.string.shortcut_disable, (d, which) -> {
                FloatingShortcutService.disable(activity);
                refresh();
            })
            .setNeutralButton(R.string.shortcut_close, null)
            .create();
        controlsDialog.show();
        refresh();
    }

    private void requestStart() {
        if (!resumed || !checkLayout() || activity.isFinishing() || FloatingShortcutService.isRunning()) return;
        if (!Settings.canDrawOverlays(activity)) {
            permissionDialog = new AlertDialog.Builder(activity)
                .setTitle(R.string.shortcut_permission_title)
                .setMessage(R.string.shortcut_permission_explanation)
                .setPositiveButton(R.string.shortcut_open_settings, (d, which) -> {
                    try {
                        activity.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + activity.getPackageName())));
                    } catch (ActivityNotFoundException | SecurityException exception) {
                        Log.w(TAG, "Android overlay settings could not be opened", exception);
                        Toast.makeText(activity, R.string.shortcut_settings_failed, Toast.LENGTH_LONG).show();
                    }
                })
                .setNegativeButton(R.string.shortcut_close, null)
                .show();
            return;
        }
        FloatingShortcutService.setRequested(activity, true);
        try {
            ContextCompat.startForegroundService(activity,
                new Intent(activity, FloatingShortcutService.class).setAction(FloatingShortcutService.ACTION_START));
        } catch (IllegalStateException | SecurityException exception) {
            Log.w(TAG, "Android rejected starting the shortcut service", exception);
            FloatingShortcutService.disable(activity);
            Toast.makeText(activity, R.string.shortcut_start_failed, Toast.LENGTH_LONG).show();
            refresh();
            return;
        }
        if (!NotificationManagerCompat.from(activity).areNotificationsEnabled()) {
            Toast.makeText(activity, R.string.shortcut_notifications_off, Toast.LENGTH_LONG).show();
        }
        refresh();
    }

    void destroy() {
        if (!available) return;
        available = false;
        FloatingShortcutService.removeStateListener(stateListener);
        dismissMenus();
        ViewCompat.setOnApplyWindowInsetsListener(control, null);
        control.setOnClickListener(null);
        TooltipCompat.setTooltipText(control, null);
        control.setVisibility(View.GONE);
        if (control.getParent() == root) root.removeView(control);
        if (webView.getParent() == root && webView.getLayoutParams() instanceof CoordinatorLayout.LayoutParams) {
            CoordinatorLayout.LayoutParams params = (CoordinatorLayout.LayoutParams) webView.getLayoutParams();
            params.bottomMargin = originalBottomMargin;
            webView.setLayoutParams(params);
        }
    }

    private void dismissMenus() {
        if (menu != null) menu.dismiss();
        if (controlsDialog != null) controlsDialog.dismiss();
        if (permissionDialog != null) permissionDialog.dismiss();
    }
}
