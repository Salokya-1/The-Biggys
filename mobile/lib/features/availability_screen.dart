import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/auth.dart';

const _days = [
  (value: 7, label: 'Sunday'),
  (value: 1, label: 'Monday'),
  (value: 2, label: 'Tuesday'),
  (value: 3, label: 'Wednesday'),
  (value: 4, label: 'Thursday'),
  (value: 5, label: 'Friday'),
];

final myUnavailabilityProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final me = ref.watch(authProvider).user;
  if (me == null) return [];
  return await ref.watch(apiProvider).get('/api/teachers/${me.id}/unavailability') as List<dynamic>;
});

/// The hours a teacher cannot be given a class. Part-time staff live here.
class AvailabilityScreen extends ConsumerWidget {
  const AvailabilityScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ref.watch(myUnavailabilityProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('My availability')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _add(context, ref),
        icon: const Icon(Icons.event_busy_outlined),
        label: const Text('Block hours'),
      ),
      body: q.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('$e', textAlign: TextAlign.center))),
        data: (items) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(myUnavailabilityProvider),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('When you cannot teach', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 6),
                    Text(
                      'Part-time hours, industry days, a standing commitment. RTE sees these and the '
                      'timetable generator will not put a class in them.',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ]),
                ),
              ),
              const SizedBox(height: 12),
              if (items.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 40),
                  child: Column(children: [
                    Icon(Icons.event_available_outlined, size: 44, color: Theme.of(context).colorScheme.outline),
                    const SizedBox(height: 12),
                    const Text('Nothing blocked'),
                    const SizedBox(height: 4),
                    Text('You are assumed free all week.', style: Theme.of(context).textTheme.bodySmall),
                  ]),
                )
              else
                for (final raw in items)
                  Builder(builder: (context) {
                    final it = raw as Map<String, dynamic>;
                    return Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: const Icon(Icons.event_busy_outlined),
                        title: Text('${it['day']} · ${it['startTime']} – ${it['endTime']}'),
                        subtitle: it['reason'] == null ? null : Text(it['reason'] as String),
                        trailing: IconButton(
                          icon: const Icon(Icons.delete_outline),
                          tooltip: 'Remove',
                          onPressed: () async {
                            final messenger = ScaffoldMessenger.of(context);
                            try {
                              await ref.read(apiProvider).request('DELETE', '/api/teachers/unavailability/${it['id']}');
                              ref.invalidate(myUnavailabilityProvider);
                              messenger.showSnackBar(const SnackBar(content: Text('Removed')));
                            } on ApiException catch (e) {
                              messenger.showSnackBar(SnackBar(content: Text(e.message)));
                            }
                          },
                        ),
                      ),
                    );
                  }),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final me = ref.read(authProvider).user;
    if (me == null) return;
    var day = 7;
    var start = const TimeOfDay(hour: 9, minute: 0);
    var end = const TimeOfDay(hour: 12, minute: 0);
    final reason = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);
    String two(int n) => n.toString().padLeft(2, '0');
    String fmt(TimeOfDay t) => '${two(t.hour)}:${two(t.minute)}';

    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, MediaQuery.of(sheetContext).viewInsets.bottom + 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Hours you cannot teach', style: Theme.of(sheetContext).textTheme.titleMedium),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              initialValue: day,
              decoration: const InputDecoration(labelText: 'Day', border: OutlineInputBorder()),
              items: [for (final d in _days) DropdownMenuItem(value: d.value, child: Text(d.label))],
              onChanged: (v) => setSheetState(() => day = v ?? 7),
            ),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () async {
                    final picked = await showTimePicker(context: sheetContext, initialTime: start);
                    if (picked != null) setSheetState(() => start = picked);
                  },
                  child: Text('From ${fmt(start)}'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: OutlinedButton(
                  onPressed: () async {
                    final picked = await showTimePicker(context: sheetContext, initialTime: end);
                    if (picked != null) setSheetState(() => end = picked);
                  },
                  child: Text('To ${fmt(end)}'),
                ),
              ),
            ]),
            const SizedBox(height: 12),
            TextField(controller: reason, decoration: const InputDecoration(labelText: 'Reason (optional)', hintText: 'Part-time — industry work', border: OutlineInputBorder())),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => Navigator.pop(sheetContext, true), child: const Text('Block these hours')),
            const SizedBox(height: 8),
          ]),
        ),
      ),
    );
    if (ok != true) return;

    // The first attempt is refused if the window covers classes they are teaching, and comes back
    // with the list and who could take each one. Only a confirmed second attempt hands them over.
    Future<void> submit({bool confirm = false}) async {
      final res = await ref.read(apiProvider).post(
        '/api/teachers/${me.id}/unavailability',
        body: {
          'dayOfWeek': day,
          'startTime': fmt(start),
          'endTime': fmt(end),
          if (reason.text.trim().isNotEmpty) 'reason': reason.text.trim(),
          if (confirm) 'confirm': true,
        },
      ) as Map<String, dynamic>;
      ref.invalidate(myUnavailabilityProvider);
      final handovers = (res['handovers'] as List?) ?? const [];
      final covered = handovers.where((h) => (h as Map)['cover'] != null).length;
      messenger.showSnackBar(SnackBar(
        content: Text(handovers.isEmpty
            ? 'Blocked. The generator will work around it.'
            : 'Blocked. $covered of ${handovers.length} class(es) handed over. Your students have been told.'),
        duration: const Duration(seconds: 6),
      ));
    }

    try {
      await submit();
    } on ApiException catch (e) {
      final details = e.details;
      final needsConfirmation = details is Map && details['needsConfirmation'] == true;
      if (!needsConfirmation) {
        messenger.showSnackBar(SnackBar(content: Text(e.message), duration: const Duration(seconds: 6)));
        return;
      }
      if (!context.mounted) return;
      final classes = (details['classes'] as List?) ?? const [];
      final goAhead = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Hand these classes over?'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(e.message),
            const SizedBox(height: 12),
            for (final raw in classes)
              Builder(builder: (context) {
                final c = raw as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(c['what'] as String, style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text(
                      c['cover'] == null ? 'Nobody on the module is free — RTE will place it' : '${c['cover']} can take it',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ]),
                );
              }),
            Text('Your students are told the lecturer has changed. Time and room stay as they are.',
                style: Theme.of(dialogContext).textTheme.bodySmall),
          ]),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Block and hand over')),
          ],
        ),
      );
      if (goAhead != true) return;
      try {
        await submit(confirm: true);
      } on ApiException catch (e2) {
        messenger.showSnackBar(SnackBar(content: Text(e2.message), duration: const Duration(seconds: 6)));
      }
    }
  }
}
