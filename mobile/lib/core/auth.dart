import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';

class AppUser {
  AppUser({required this.id, required this.email, required this.name, required this.role, this.studentId});
  final String id;
  final String email;
  final String name;
  final String role;
  final String? studentId;
  bool get isStudent => role == 'STUDENT';
  bool get isStaff => !isStudent;
  bool get canReview => role == 'ADMIN' || role == 'MODULE_LEADER';

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: j['id'] as String,
        email: j['email'] as String,
        name: j['name'] as String,
        role: j['role'] as String,
        studentId: j['studentId'] as String?,
      );
  Map<String, dynamic> toJson() => {'id': id, 'email': email, 'name': name, 'role': role, 'studentId': studentId};
}

class AuthState {
  const AuthState({this.user, this.loading = true, this.serverWaking = false});
  final AppUser? user;
  final bool loading;
  final bool serverWaking;
  bool get signedIn => user != null;
  AuthState copyWith({AppUser? user, bool? loading, bool? serverWaking, bool clearUser = false}) =>
      AuthState(user: clearUser ? null : (user ?? this.user), loading: loading ?? this.loading, serverWaking: serverWaking ?? this.serverWaking);
}

class AuthNotifier extends Notifier<AuthState> {
  @override
  AuthState build() {
    Future.microtask(_init);
    return const AuthState();
  }

  ApiClient get _api => ref.read(apiProvider);

  Future<void> _init() async {
    // Cold-start check: Antideploy scales to zero, so the first request can take a second or two.
    final ok = await _api.healthy();
    if (!ok) {
      state = state.copyWith(serverWaking: true);
      await Future<void>.delayed(const Duration(seconds: 2));
      await _api.healthy();
      state = state.copyWith(serverWaking: false);
    }
    final tokens = await TokenStore.read();
    if (tokens == null) {
      state = state.copyWith(loading: false);
      return;
    }
    try {
      final me = await _api.get('/auth/me');
      state = AuthState(user: AppUser.fromJson(me as Map<String, dynamic>), loading: false);
      await CacheStore.put('me', me);
    } on ApiException catch (e) {
      if (e.status == 401) {
        await TokenStore.clear();
        state = const AuthState(loading: false);
      } else {
        // offline: trust the cached identity so the app still opens
        final cached = await CacheStore.get('me');
        state = AuthState(user: cached == null ? null : AppUser.fromJson(cached.data as Map<String, dynamic>), loading: false);
      }
    }
  }

  Future<AppUser> login(String email, String password) async {
    final res = await _api.post('/auth/login', body: {'email': email, 'password': password}, auth: false) as Map<String, dynamic>;
    await TokenStore.write(Tokens(res['accessToken'] as String, res['refreshToken'] as String));
    final user = AppUser.fromJson(res['user'] as Map<String, dynamic>);
    await CacheStore.put('me', res['user']);
    state = AuthState(user: user, loading: false);
    return user;
  }

  Future<void> logout() async {
    final t = await TokenStore.read();
    await TokenStore.clear();
    await CacheStore.clearAll();
    state = const AuthState(loading: false);
    if (t != null) {
      try {
        await _api.post('/auth/logout', body: {'refreshToken': t.refresh}, auth: false);
      } catch (_) {}
    }
  }

  /// Re-run initialisation after the API base URL changes.
  Future<void> reinit() async {
    state = const AuthState();
    ref.invalidate(apiBaseUrlProvider);
    await _init();
  }
}

final authProvider = NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);
