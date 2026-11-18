package app.prevenza.scamguard;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareTargetPlugin.class);
        super.onCreate(savedInstanceState);
        ShareTargetPlugin.accept(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ShareTargetPlugin.accept(intent);
    }
}
