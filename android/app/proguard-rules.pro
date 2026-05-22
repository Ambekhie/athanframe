# R8/ProGuard rules for the release build.
# We don't ship a release build yet; this is here for future use.

# Keep NanoHTTPD reflection-friendly classes
-keep class fi.iki.elonen.** { *; }
-keep class org.nanohttpd.** { *; }

# Kotlin coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}

# kotlinx-serialization
-keepclassmembers class **$$serializer { *; }
-keep,includedescriptorclasses class com.athanframe.bridge.**$$serializer { *; }
