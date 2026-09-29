# ProGuard / R8 rules for StockFlow ERP.
#
# The application is a WebView wrapper: there is no Java business logic to
# shrink. What R8 *can* damage is the bridge itself, because Capacitor resolves
# each plugin's implementation class by name at runtime from the JS side. Those
# classes have no compile-time caller, so R8 sees them as unreachable and strips
# them — the app still launches and then every plugin call throws.

# Keep the annotations R8 needs to read the plugin metadata off.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions

# MainActivity is the Android entry point named in the manifest.
-keep class app.stockflow.erp.MainActivity { *; }

# Capacitor plugin implementations. The Bridge reads
# assets/capacitor.plugins.json and does Class.forName on every classpath in it,
# so these must keep their exact names — a renamed class is just as unreachable
# as a deleted one.
#
# Note the package: the plugins live under com.capacitorjs.plugins.*, NOT
# com.getcapacitor.* (which is only the core bridge). An earlier version of these
# rules kept the wrong package and would have let every plugin be stripped.
-keep class com.capacitorjs.plugins.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * {
    public *;
    protected *;
}
-keep class * extends com.getcapacitor.Plugin { *; }

# The bridge itself, instantiated by name from native code.
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }

# WebView JS interface object, added in newer Capacitor versions.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# androidx.activity / fragment are referenced reflectively by Capacitor's
# lifecycle handling.
-keep class androidx.activity.** { *; }
-dontwarn androidx.activity.**

# Kotlin: the plugins are compiled Kotlin and reference these in metadata.
-dontwarn kotlin.**
-keep class kotlin.Metadata { *; }

# Silence warnings from optional Play Services classes. The app does not
# currently use them, but Capacitor's optional integrations reference them.
-dontwarn com.google.android.play.core.**
-dontwarn com.google.firebase.**
-dontwarn javax.naming.**
