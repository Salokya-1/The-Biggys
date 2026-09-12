import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/data.dart';
import '../widgets/common.dart';

/// The teaching week runs Sunday to Friday; Saturday never carries a class.
const _teachingWeek = [
  (dayOfWeek: 7, label: 'Sun'),
  (dayOfWeek: 1, label: 'Mon'),
  (dayOfWeek: 2, label: 'Tue'),
  (dayOfWeek: 3, label: 'Wed'),
  (dayOfWeek: 4, label: 'Thu'),
  (dayOfWeek: 5, label: 'Fri'),
];

const _kindLabel = {'LECTURE': 'Lecture', 'TUTORIAL': 'Tutorial', 'WORKSHOP': 'Workshop'};

Color _kindColour(BuildContext context, String? kind) => switch (kind) {
      'LECTURE' => Theme.of(context).colorScheme.primary,
      'WORKSHOP' => const Color(0xFFE37E3F),
      'TUTORIAL' => const Color(0xFF2F6AAF),
      _ => Theme.of(context).colorScheme.outline,
    };

/// This week's classes: a student sees their group's routine, a teacher sees what they teach.
class TimetableScreen extends ConsumerStatefulWidget {
  const TimetableScreen({super.key});
  @override
  ConsumerState<TimetableScreen> createState() => _TimetableScreenState();
}

class _TimetableScreenState extends ConsumerState<TimetableScreen> {
  int _day = -1; // -1 until the first build picks today

  @override
  Widget build(BuildContext context) {
    final q = ref.watch(myWeekProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Timetable')),
      body: q.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(message: '$e', onRetry: () => ref.invalidate(myWeekProvider)),
        data: (c) {
          final week = c.data as Map<String, dynamic>;
          final days = (week['days'] as List).cast<Map<String, dynamic>>();
          // The API returns seven days from the week's Sunday; Saturday is dropped.
          final shown = [for (var i = 0; i < 6; i++) days[i]];
          final todayIso = DateTime.now().toIso8601String().substring(0, 10);
          final todayIndex = shown.indexWhere((d) => d['date'] == todayIso);
          final selected = _day >= 0 ? _day : (todayIndex >= 0 ? todayIndex : 0);
          final items = (shown[selected]['items'] as List).cast<Map<String, dynamic>>();

          return Column(children: [
            StaleBanner(stale: c.stale, syncedAt: c.syncedAt),
            SizedBox(
              height: 74,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                itemCount: shown.length,
                itemBuilder: (_, i) {
                  final d = shown[i];
                  final n = (d['items'] as List).length;
                  final isToday = d['date'] == todayIso;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      selected: i == selected,
                      onSelected: (_) => setState(() => _day = i),
                      label: Column(mainAxisSize: MainAxisSize.min, children: [
                        Text('${_teachingWeek[i].label}${isToday ? ' •' : ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text(n == 0 ? 'free' : '$n', style: const TextStyle(fontSize: 11)),
                      ]),
                    ),
                  );
                },
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async => ref.invalidate(myWeekProvider),
                child: items.isEmpty
                    ? ListView(children: const [SizedBox(height: 80), EmptyState(icon: Icons.event_available_outlined, title: 'No classes', subtitle: 'Nothing scheduled for this day.')])
                    : ListView.builder(
                        padding: const EdgeInsets.all(12),
                        itemCount: items.length,
                        itemBuilder: (_, i) => _ClassCard(item: items[i]),
                      ),
              ),
            ),
          ]);
        },
      ),
    );
  }
}

class _ClassCard extends StatelessWidget {
  const _ClassCard({required this.item});
  final Map<String, dynamic> item;

  @override
  Widget build(BuildContext context) {
    final isExam = item['kind'] == 'EXAM';
    final cancelled = item['status'] == 'CANCELLED';
    final kind = item['classKind'] as String?;
    final groups = (item['groups'] as List?)?.cast<String>() ?? const [];
    final venue = item['venue'] as Map<String, dynamic>?;
    final teacher = item['teacher'] as Map<String, dynamic>?;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 4, height: 52, color: isExam ? const Color(0xFFCE2626) : _kindColour(context, kind)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text(
                    item['title'] as String,
                    style: TextStyle(fontWeight: FontWeight.w600, decoration: cancelled ? TextDecoration.lineThrough : null),
                  ),
                ),
                if (isExam) const Pill('EXAM') else if (kind != null) Pill(_kindLabel[kind] ?? kind),
              ]),
              const SizedBox(height: 4),
              Text('${item['startTime']} – ${item['endTime']}', style: Theme.of(context).textTheme.bodyMedium),
              if (groups.isNotEmpty) Text(groups.join('+'), style: Theme.of(context).textTheme.bodySmall),
              Text(
                [if (venue != null) venue['name'] as String, if (teacher != null) teacher['name'] as String].join(' · '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (item['seat'] != null) Text('Seat ${item['seat']}', style: TextStyle(fontWeight: FontWeight.w600, color: Theme.of(context).colorScheme.primary)),
              if (cancelled) Text('Cancelled — ${(item['change'] as Map?)?['reason'] ?? ''}', style: const TextStyle(color: Color(0xFFCE2626), fontSize: 12)),
              if (item['status'] == 'CHANGED') Text('Changed — ${(item['change'] as Map?)?['reason'] ?? ''}', style: const TextStyle(color: Color(0xFFE37E3F), fontSize: 12)),
            ]),
          ),
        ]),
      ),
    );
  }
}
