package com.shiftsaas.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable edge-to-edge
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Disable WebView cache so updates from Firebase Hosting load immediately
        getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);

        // Detect actual nav bar height and inject as CSS variable
        ViewCompat.setOnApplyWindowInsetsListener(getBridge().getWebView(), (v, insets) -> {
            int bottomPx = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            String js = "document.documentElement.style.setProperty('--nav-bar-height', '" + bottomPx + "px')";
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(js, null)
            );
            return insets;
        });
    }
}
