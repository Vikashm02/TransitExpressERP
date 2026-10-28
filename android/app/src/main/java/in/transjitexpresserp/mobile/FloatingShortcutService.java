package in.transjitexpresserp.mobile;

import android.annotation.SuppressLint;
import android.app.AppOpsManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.appcompat.widget.AppCompatImageButton;

import java.lang.ref.WeakReference;
import java.util.LinkedHashSet;
import java.util.Set;

/** Owns only the launcher window. Never owns an Activity, WebView, login, or ERP route. */
public final class FloatingShortcutService extends Service {
    static final String ACTION_START = "in.transjitexpresserp.mobile.shortcut.START";
    private static final String ACTION_STOP = "in.transjitexpresserp.mobile.shortcut.STOP";
    private static final String PREFERENCES = "floating_shortcut_v1";
    private static final String REQUESTED = "requested";
    private static final String CHANNEL = "transjit_floating_shortcut_v1";
    private static final int NOTIFICATION_ID = 730101;
    private static final Set<Runnable> STATE_LISTENERS = new LinkedHashSet<>();
    private static WeakReference<FloatingShortcutService> current = new WeakReference<>(null);
    private static boolean erpVisible;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private AppOpsManager appOps;
    private ShortcutButton bubble;
    private WindowManager.LayoutParams windowParams;
    private boolean attached;
    private boolean running;
    private boolean watchingPermission;
    private int insetLeft;
    private int insetTop;
    private int insetRight;
    private int insetBottom;
    private float downX;
    private float downY;
    private int startX;
    private int startY;
    private boolean dragged;
    private boolean cancelled;

    private final AppOpsManager.OnOpChangedListener permissionListener = (op, packageName) ->
        handler.post(this::validatePermission);
    private final Runnable permissionCheck = new Runnable() {
        @Override
        public void run() {
            validatePermission();
            // Fallback for devices whose app-op callbacks are delayed. No wake lock or alarms.
            if (running) handler.postDelayed(this, 3000);
        }
    };
    private final Runnable updateVisibility = this::refreshVisibility;

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static boolean isRequested(Context context) {
        return preferences(context).getBoolean(REQUESTED, false);
    }

    static void setRequested(Context context, boolean requested) {
        preferences(context).edit().putBoolean(REQUESTED, requested).apply();
    }

    static boolean isRunning() {
        FloatingShortcutService service = current.get();
        return service != null && service.running;
    }

    static void addStateListener(Runnable listener) {
        STATE_LISTENERS.add(listener);
    }

    static void removeStateListener(Runnable listener) {
        STATE_LISTENERS.remove(listener);
    }

    private static void publishState() {
        for (Runnable listener : new LinkedHashSet<>(STATE_LISTENERS)) listener.run();
    }

    static void disable(Context context) {
        setRequested(context, false);
        FloatingShortcutService service = current.get();
        if (service != null) service.shutdown();
        context.stopService(new Intent(context, FloatingShortcutService.class));
        publishState();
    }

    static void setErpVisible(boolean visible) {
        erpVisible = visible;
        FloatingShortcutService service = current.get();
        if (service != null) {
            service.handler.removeCallbacks(service.updateVisibility);
            if (visible) service.refreshVisibility();
            else service.handler.postDelayed(service.updateVisibility, 200);
        }
    }

    static void checkPermission() {
        FloatingShortcutService service = current.get();
        if (service != null) service.validatePermission();
    }

    static Intent resumeIntent(Context context) {
        // singleTask reuses MainActivity. No URI, action, CLEAR_TASK, or route payload.
        return new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        appOps = (AppOpsManager) getSystemService(APP_OPS_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            disable(this);
            return START_NOT_STICKY;
        }
        if (intent == null || !ACTION_START.equals(intent.getAction())
            || !isRequested(this) || !Settings.canDrawOverlays(this)) {
            shutdown();
            return START_NOT_STICKY;
        }
        if (running) return START_NOT_STICKY;
        try {
            Notification notification = createNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            running = true;
            current = new WeakReference<>(this);
            if (appOps != null) {
                appOps.startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, getPackageName(), permissionListener);
                watchingPermission = true;
            }
            refreshVisibility();
            if (running) handler.post(permissionCheck);
            publishState();
        } catch (RuntimeException exception) {
            setRequested(this, false);
            shutdown();
            Toast.makeText(this, R.string.shortcut_start_failed, Toast.LENGTH_LONG).show();
        }
        // Preference is explanatory only: never recreate the shortcut after process/user stop.
        return START_NOT_STICKY;
    }

    private Notification createNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL,
                getString(R.string.shortcut_channel_name), NotificationManager.IMPORTANCE_LOW);
            channel.setDescription(getString(R.string.shortcut_channel_description));
            channel.setSound(null, null);
            channel.enableVibration(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        PendingIntent open = PendingIntent.getActivity(this, NOTIFICATION_ID, resumeIntent(this),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, NOTIFICATION_ID,
            new Intent(this, FloatingShortcutService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_transjit_notification)
            .setContentTitle(getString(R.string.shortcut_notification_title))
            .setContentText(getString(R.string.shortcut_notification_text))
            .setContentIntent(open)
            .addAction(0, getString(R.string.shortcut_open_erp), open)
            .addAction(0, getString(R.string.shortcut_stop), stop)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    private void validatePermission() {
        if (running && (!isRequested(this) || !Settings.canDrawOverlays(this))) {
            setRequested(this, false);
            shutdown();
        }
    }

    private void refreshVisibility() {
        validatePermission();
        if (!running) return;
        if (erpVisible) {
            removeBubble();
        } else if (!attached) {
            try {
                createBubble();
                windowManager.addView(bubble, windowParams);
                attached = true;
            } catch (RuntimeException exception) {
                setRequested(this, false);
                shutdown();
                Toast.makeText(this, R.string.shortcut_start_failed, Toast.LENGTH_LONG).show();
            }
        }
    }

    @SuppressWarnings("deprecation") // TYPE_PHONE is needed only on supported API 24-25.
    @SuppressLint("RtlHardcoded") // Drag positions are absolute screen coordinates, independent of locale.
    private void createBubble() {
        int size = Math.round(56 * getResources().getDisplayMetrics().density);
        bubble = new ShortcutButton(this);
        bubble.setImageResource(R.mipmap.transjit_logo);
        bubble.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        bubble.setPadding(size / 8, size / 8, size / 8, size / 8);
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(0xFFFFFFFF);
        background.setStroke(Math.max(1, size / 56), 0xFF475569);
        bubble.setBackground(background);
        bubble.setElevation(8 * getResources().getDisplayMetrics().density);
        bubble.setContentDescription(getString(R.string.shortcut_accessibility));
        bubble.setOnClickListener(view -> {
            validatePermission();
            if (!running) return;
            try {
                startActivity(resumeIntent(this));
            } catch (RuntimeException exception) {
                Toast.makeText(this, R.string.shortcut_start_failed, Toast.LENGTH_LONG).show();
            }
        });
        windowParams = new WindowManager.LayoutParams(size, size,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        windowParams.gravity = Gravity.TOP | Gravity.LEFT;
        windowParams.x = preferences(this).getInt("x", size / 2);
        windowParams.y = preferences(this).getInt("y", size * 2);
        clampPosition();
        bubble.setOnApplyWindowInsetsListener((view, insets) -> {
            readInsets(insets);
            int oldX = windowParams.x;
            int oldY = windowParams.y;
            clampPosition();
            if (oldX != windowParams.x || oldY != windowParams.y) updatePosition();
            return insets;
        });
        bubble.setOnTouchListener(this::onBubbleTouch);
    }

    private boolean onBubbleTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downX = event.getRawX();
                downY = event.getRawY();
                startX = windowParams.x;
                startY = windowParams.y;
                dragged = false;
                cancelled = false;
                return true;
            case MotionEvent.ACTION_POINTER_DOWN:
                cancelled = true;
                return true;
            case MotionEvent.ACTION_MOVE:
                if (cancelled) return true;
                float dx = event.getRawX() - downX;
                float dy = event.getRawY() - downY;
                int slop = ViewConfiguration.get(this).getScaledTouchSlop();
                if (dx * dx + dy * dy > slop * slop) dragged = true;
                if (dragged) {
                    windowParams.x = startX + Math.round(dx);
                    windowParams.y = startY + Math.round(dy);
                    updatePosition();
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (!cancelled && !dragged) view.performClick();
                else if (dragged) savePosition();
                return true;
            case MotionEvent.ACTION_CANCEL:
                cancelled = true;
                if (dragged) savePosition();
                return true;
            default:
                return true;
        }
    }

    @SuppressWarnings("deprecation")
    private void readInsets(WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Insets safe = insets.getInsetsIgnoringVisibility(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            insetLeft = safe.left;
            insetTop = safe.top;
            insetRight = safe.right;
            insetBottom = safe.bottom;
        } else {
            insetLeft = insets.getSystemWindowInsetLeft();
            insetTop = insets.getSystemWindowInsetTop();
            insetRight = insets.getSystemWindowInsetRight();
            insetBottom = insets.getSystemWindowInsetBottom();
        }
    }

    @SuppressWarnings("deprecation")
    private void clampPosition() {
        Rect bounds = new Rect();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.view.WindowMetrics metrics = windowManager.getCurrentWindowMetrics();
            bounds.set(metrics.getBounds());
            readInsets(metrics.getWindowInsets());
        } else {
            android.util.DisplayMetrics metrics = new android.util.DisplayMetrics();
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
            bounds.set(0, 0, metrics.widthPixels, metrics.heightPixels);
        }
        int maxX = Math.max(insetLeft, bounds.width() - insetRight - windowParams.width);
        int maxY = Math.max(insetTop, bounds.height() - insetBottom - windowParams.height);
        windowParams.x = Math.max(insetLeft, Math.min(windowParams.x, maxX));
        windowParams.y = Math.max(insetTop, Math.min(windowParams.y, maxY));
    }

    private void updatePosition() {
        clampPosition();
        if (attached) {
            try {
                windowManager.updateViewLayout(bubble, windowParams);
            } catch (RuntimeException exception) {
                setRequested(this, false);
                shutdown();
            }
        }
    }

    private void savePosition() {
        preferences(this).edit().putInt("x", windowParams.x).putInt("y", windowParams.y).apply();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (attached) updatePosition();
    }

    private void removeBubble() {
        if (attached) {
            try {
                windowManager.removeViewImmediate(bubble);
            } catch (IllegalArgumentException exception) {
                // The system can remove the window first when overlay access is revoked.
            }
        }
        attached = false;
        bubble = null;
    }

    private void shutdown() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        removeBubble();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (current.get() == this) current.clear();
        publishState();
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (watchingPermission && appOps != null) appOps.stopWatchingMode(permissionListener);
        shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static final class ShortcutButton extends AppCompatImageButton {
        ShortcutButton(Context context) {
            super(context);
        }

        @Override
        public boolean performClick() {
            // Touch-up and accessibility both use the same click listener.
            return super.performClick();
        }
    }
}
