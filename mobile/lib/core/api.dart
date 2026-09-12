import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.status, this.details});
  final String message;
  final int? status;
  final dynamic details;
  @override
  String toString() => message;
}

class Tokens {
  Tokens(this.access, this.refresh);
  final String access;
  final String refresh;
}

/// Tokens live in the platform keystore-backed secure storage, never in plain prefs.
class TokenStore {
  static const _storage = FlutterSecureStorage();
  static Future<Tokens?> read() async {
    final a = await _storage.read(key: 'access');
    final r = await _storage.read(key: 'refresh');
    if (a == null || r == null) return null;
    return Tokens(a, r);
  }

  static Future<void> write(Tokens t) async {
    await _storage.write(key: 'access', value: t.access);
    await _storage.write(key: 'refresh', value: t.refresh);
  }

  static Future<void> clear() async {
    await _storage.delete(key: 'access');
    await _storage.delete(key: 'refresh');
  }
}

/// Last successful response per screen, so the app opens offline with "last synced at".
class CacheStore {
  static Future<void> put(String key, dynamic json) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('cache:$key', jsonEncode({'at': DateTime.now().toIso8601String(), 'data': json}));
  }

  static Future<({dynamic data, DateTime at})?> get(String key) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('cache:$key');
    if (raw == null) return null;
    final m = jsonDecode(raw) as Map<String, dynamic>;
    return (data: m['data'], at: DateTime.parse(m['at'] as String));
  }

  static Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    for (final k in prefs.getKeys().where((k) => k.startsWith('cache:')).toList()) {
      await prefs.remove(k);
    }
  }
}

class ApiClient {
  ApiClient(this.baseUrl) : _dio = Dio(BaseOptions(baseUrl: baseUrl, connectTimeout: const Duration(seconds: 8), receiveTimeout: const Duration(seconds: 15)));

  final String baseUrl;
  final Dio _dio;
  Future<Tokens?>? _refreshing;

  Future<Map<String, String>> _authHeaders() async {
    final t = await TokenStore.read();
    return t == null ? {} : {'authorization': 'Bearer ${t.access}'};
  }

  Future<Tokens?> _refresh() {
    return _refreshing ??= () async {
      try {
        final t = await TokenStore.read();
        if (t == null) return null;
        final res = await _dio.post('/auth/refresh', data: {'refreshToken': t.refresh});
        final next = Tokens(res.data['accessToken'] as String, res.data['refreshToken'] as String);
        await TokenStore.write(next);
        return next;
      } catch (_) {
        await TokenStore.clear();
        return null;
      } finally {
        _refreshing = null;
      }
    }();
  }

  Future<dynamic> request(String method, String path, {dynamic body, bool auth = true, bool retry = true}) async {
    try {
      final res = await _dio.request(
        path,
        data: body,
        options: Options(method: method, headers: auth ? await _authHeaders() : null, validateStatus: (_) => true),
      );
      if (res.statusCode == 401 && auth && retry) {
        final next = await _refresh();
        if (next != null) return await request(method, path, body: body, auth: auth, retry: false);
      }
      if (res.statusCode == null || res.statusCode! >= 400) {
        final data = res.data;
        final msg = data is Map && data['message'] != null ? data['message'].toString() : 'Request failed (${res.statusCode})';
        throw ApiException(msg, status: res.statusCode, details: data is Map ? data['details'] : null);
      }
      return res.data;
    } on DioException catch (e) {
      throw ApiException(e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.connectionError ? 'Cannot reach the server' : (e.message ?? 'Network error'));
    }
  }

  Future<dynamic> get(String path, {bool auth = true}) => request('GET', path, auth: auth);
  Future<dynamic> post(String path, {dynamic body, bool auth = true}) => request('POST', path, body: body ?? {}, auth: auth);

  /// Network first; on failure fall back to the cached copy (marked stale).
  Future<({dynamic data, bool stale, DateTime? syncedAt})> cached(String key, String path) async {
    try {
      final data = await get(path);
      await CacheStore.put(key, data);
      return (data: data, stale: false, syncedAt: DateTime.now());
    } on ApiException catch (e) {
      if (e.status != null && e.status! >= 400 && e.status! < 500) rethrow; // real API error, not connectivity
      final c = await CacheStore.get(key);
      if (c == null) rethrow;
      return (data: c.data, stale: true, syncedAt: c.at);
    }
  }

  Future<bool> healthy() async {
    try {
      final res = await _dio.get('/health', options: Options(receiveTimeout: const Duration(seconds: 3)));
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}

final apiBaseUrlProvider = FutureProvider<String>((ref) => AppSettings.apiBaseUrl());

final apiProvider = Provider<ApiClient>((ref) {
  final url = ref.watch(apiBaseUrlProvider).value ?? kDefaultApiUrl;
  return ApiClient(url);
});
