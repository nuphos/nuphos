package ai.nuphos.sharefixture;

import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
import android.widget.Button;
import android.widget.LinearLayout;
import java.util.ArrayList;

/** Disposable sender: no network permission, credentials, user files or arbitrary URI input. */
public class ShareSenderActivity extends Activity {
    private String pendingMode;
    private boolean pendingChooser;
    private static final String RECEIVER = (BuildConfig.APPLICATION_ID.contains("sharepersist1359") ? "ai.nuphos.android.sharepersist1359" : "ai.nuphos.android.shareinput1355");
    private Uri uri(String name) { return Uri.parse("content://" + BuildConfig.APPLICATION_ID + ".files/" + name); }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        pendingMode = getIntent().getStringExtra("fixtureMode");
        pendingChooser = getIntent().getBooleanExtra("chooser", false);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        for (String item : new String[]{"text", "image", "multiple", "denied", "oversize"}) {
            Button button = new Button(this); button.setText("Share synthetic " + item);
            button.setOnClickListener(view -> share(item, true)); layout.addView(button);
        }
        setContentView(layout);
    }
    @Override public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingMode = intent.getStringExtra("fixtureMode");
        pendingChooser = intent.getBooleanExtra("chooser", false);
    }
    @Override protected void onPostResume() {
        super.onPostResume();
        if (pendingMode != null) {
            final String mode = pendingMode;
            final boolean chooser = pendingChooser;
            pendingMode = null;
            getWindow().getDecorView().post(() -> share(mode, chooser));
        }
    }
    private void share(String mode, boolean chooser) {
        if ("revoke".equals(mode)) {
            revokeUriPermission(uri("fixture.txt"), Intent.FLAG_GRANT_READ_URI_PERMISSION);
            revokeUriPermission(uri("image.png"), Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(new Intent().setClassName(RECEIVER, "ai.nuphos.android.MainActivity").putExtra("fixtureReceipt", getIntent().getStringExtra("fixtureReceipt")));
            return;
        }
        Intent intent = new Intent(Intent.ACTION_SEND).setType("text/plain");
        intent.putExtra(Intent.EXTRA_TEXT, "Synthetic shared note https://example.com/share-fixture");
        if (!"text".equals(mode)) {
            String name = "image".equals(mode) ? "image.png" : "denied".equals(mode) ? "denied.txt" : "oversize".equals(mode) ? "oversize.txt" : "fixture.txt";
            Uri first = uri(name);
            intent.setType("image".equals(mode) ? "image/png" : "application/octet-stream");
            ClipData clip = ClipData.newRawUri("Synthetic share", first);
            if ("multiple".equals(mode)) {
                intent.setAction(Intent.ACTION_SEND_MULTIPLE);
                ArrayList<Uri> items = new ArrayList<>(); items.add(first); items.add(uri("image.png"));
                intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, items);
                clip.addItem(new ClipData.Item(uri("image.png")));
            } else intent.putExtra(Intent.EXTRA_STREAM, first);
            intent.setClipData(clip);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
        intent.setPackage(RECEIVER); // Keep the disposable system chooser scoped to this receiver.
        startActivity(chooser ? Intent.createChooser(intent, "Synthetic share verification") : intent);
    }
}
