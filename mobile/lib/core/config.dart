import 'package:shared_preferences/shared_preferences.dart';

/// Default API base URL.
///
/// The deployed API, so an APK installed on a real phone works without being configured. Point it
/// somewhere else at build time with `--dart-define=API_URL=…` (the Android emulator reaches the
/// host machine on 10.0.2.2), or change it in the app's own Settings screen.
const kDefaultApiUrl = String.fromEnvironment('API_URL', defaultValue: 'https://biggys-api.onrender.com');

const kDemoPassword = 'Demo1234!';
const kDemoAccounts = <String, String>{
  'Student': 'student1@demo',
  'Lecturer': 'lecturer@demo',
  'Module leader': 'leader@demo',
  'RTE admin': 'admin@demo',
};

class AppSettings {
  static const _key = 'apiBaseUrl';

  static Future<String> apiBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key) ?? kDefaultApiUrl;
  }

  static Future<void> setApiBaseUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    final trimmed = url.trim().replaceAll(RegExp(r'/+$'), '');
    if (trimmed.isEmpty) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, trimmed);
    }
  }
}
