import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';

typedef Cached = ({dynamic data, bool stale, DateTime? syncedAt});

Cached _live(dynamic data) => (data: data, stale: false, syncedAt: DateTime.now());

/// Student profile with results (published only — filtered by the API).
final profileProvider = FutureProvider.autoDispose<Cached>((ref) => ref.watch(apiProvider).cached('profile', '/api/students/me'));

/// Upcoming exam sessions with the student's seat.
final examsProvider = FutureProvider.autoDispose<Cached>((ref) => ref.watch(apiProvider).cached('exams', '/api/exams/me'));

/// Notifications for the signed-in user.
final notificationsProvider = FutureProvider.autoDispose<Cached>((ref) => ref.watch(apiProvider).cached('notifications', '/api/notifications'));

/// This week's classes: a student's own group routine, or everything a teacher teaches.
final myWeekProvider = FutureProvider.autoDispose<Cached>((ref) => ref.watch(apiProvider).cached('my-week', '/api/timetable/me'));

/// Staff: mark sheets in scope (approval queue).
final sheetsProvider = FutureProvider.autoDispose<Cached>((ref) => ref.watch(apiProvider).cached('sheets', '/api/marksheets'));

/// Staff: one sheet's review summary (always live — it drives an action).
final sheetDetailProvider = FutureProvider.autoDispose.family<Cached, String>((ref, id) async => _live(await ref.watch(apiProvider).get('/api/marksheets/$id')));
