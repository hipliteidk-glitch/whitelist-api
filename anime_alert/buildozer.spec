[app]

# (str) Title of your application
title = Anime Alert

# (str) Package name
package.name = animealert

# (str) Package domain (used for Java package name)
package.domain = org.animealert

# (str) Source code where the main.py live
source.dir = .

# (list) Source files to include (let empty to include all the files)
source.include_exts = py,png,jpg,kv,atlas,ttf

# (list) List of inclusions using pattern matching
#source.include_patterns = assets/*, images/*.png

# (list) Source files to exclude (let empty to not exclude anything)
#source.exclude_exts = spec

# (list) List of directory names to not include in the APK
#source.exclude_dirs = tests, bin, docs

# (list) List of exclusions using pattern matching
#source.exclude_patterns = license,images/*/.png

# (str) Application versioning (method 1)
version = 0.1

# (list) Application requirements
requirements = python3,kivy,requests

# (str) Supported orientation (one of landscape, sensorLandscape, portrait or all)
orientation = portrait

# (list) List of service to declare
# services = NAME:ENTRYPOINT_TO_SERVICE

# (list) Permissions
android.permissions = INTERNET,WAKE_LOCK,FOREGROUND_SERVICE

# (int) Android API to use (default = 30)
android.api = 30

# (int) Minimum API required (default = 21)
android.minapi = 21

# (int) Android SDK version (default = 20)
#android.sdk = 20

# (str) Android NDK version (default = 19c)
#android.ndk = 19c

# (int) Android NDK API to use (default = 21)
#android.ndk_api = 21

# (bool) Accept buildozer's SDK license agreements (default = False)
android.accept_sdk_license = True
