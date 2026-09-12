import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/data.dart';
import '../widgets/common.dart';

/// Review summary + approve / reject for module leaders and admins (no editing on mobile).
class SheetScreen extends ConsumerStatefulWidget {
  const SheetScreen({super.key, required this.id});
  final String id;
  @override
  ConsumerState<SheetScreen> createState() => _SheetScreenState();
}

class _SheetScreenState extends ConsumerState<SheetScreen> {
  bool _busy = false;

  Future<void> _act(String action, int lockVersion, {String? reason}) async {
    setState(() => _busy = true);
    try {
      final res = await ref.read(apiProvider).post('/api/marksheets/${widget.id}/transition', body: {'action': action, 'lockVersion': lockVersion, if (reason != null) 'reason': reason});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Now ${(res['status'] as String).replaceAll('_', ' ')}')));
      ref.invalidate(sheetDetailProvider(widget.id));
      ref.invalidate(sheetsProvider);
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      ref.invalidate(sheetDetailProvider(widget.id));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withReason(String action, String title, int lockVersion) async {
    final ctrl = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(controller: ctrl, decoration: const InputDecoration(labelText: 'Reason (required, recorded in the audit log)'), maxLines: 3),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Confirm')),
        ],
      ),
    );
    if (reason != null && reason.length >= 3) await _act(action, lockVersion, reason: reason);
  }

  @override
  Widget build(BuildContext context) {
    final q = ref.watch(sheetDetailProvider(widget.id));
    return Scaffold(
      appBar: AppBar(title: const Text('Mark sheet')),
      body: q.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ErrorState(message: e.toString(), onRetry: () => ref.invalidate(sheetDetailProvider(widget.id))),
        data: (c) {
          final d = c.data as Map<String, dynamic>;
          final sheet = d['sheet'] as Map<String, dynamic>;
          final off = d['offering'] as Map<String, dynamic>;
          final rows = (d['rows'] as List).cast<Map<String, dynamic>>();
          final flags = (d['flags'] as List).cast<Map<String, dynamic>>().where((f) => f['level'] == 'warning').toList();
          final validation = d['validation'] as Map<String, dynamic>;
          final actions = (d['actions'] as List).cast<String>();
          final lock = sheet['lockVersion'] as int;
          int n(String o) => rows.where((r) => r['computed']?['outcome'] == o).length;
          final labels = {'submit': 'Submit', 'start_review': 'Start review', 'approve': 'Approve', 'reject': 'Return', 'publish': 'Publish', 'request_correction': 'Request correction'};
          return ListView(padding: const EdgeInsets.all(16), children: [
            Text('${off['module']['code']} · ${off['module']['title']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text('Intake ${off['semester']['intake']['label']} · Sem ${off['semester']['number']} · v${sheet['version']} · ${off['lecturer']?['name'] ?? '—'}', style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 8),
            Row(children: [Pill((sheet['status'] as String).replaceAll('_', ' '), color: statusColor(sheet['status'] as String))]),
            const SizedBox(height: 16),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final o in ['PASS', 'RESIT', 'FAIL', 'DEFERRED']) Pill('$o ${n(o)}', color: outcomeColor(o)),
              Pill('${rows.length} students'),
            ]),
            const SizedBox(height: 16),
            if ((validation['errors'] as List).isNotEmpty)
              Card(color: Colors.red.shade50, child: Padding(padding: const EdgeInsets.all(12), child: Text('${(validation['errors'] as List).length} issue(s) block submission:\n${(validation['errors'] as List).take(5).join('\n')}'))),
            Text('Statistical flags', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            if (flags.isEmpty) const Text('Nothing unusual detected.', style: TextStyle(color: Colors.grey)),
            for (final f in flags)
              Card(color: Colors.amber.shade50, child: ListTile(dense: true, leading: const Icon(Icons.warning_amber, color: Colors.amber), title: Text(f['message'] as String))),
            const SizedBox(height: 16),
            Text('Results', style: Theme.of(context).textTheme.titleSmall),
            for (final r in rows)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text('${r['student']['studentId']} · ${r['student']['name']}'),
                subtitle: Text(r['computed'] == null ? 'no marks' : 'overall ${r['computed']['overallMark']} · ${(r['computed']['reasons'] as List).join('; ')}'),
                trailing: r['computed'] == null ? null : Pill('${r['computed']['grade']} · ${r['computed']['outcome']}', color: outcomeColor(r['computed']['outcome'] as String?)),
              ),
            const SizedBox(height: 16),
            if (actions.isNotEmpty)
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final a in actions.where((a) => a != 'submit'))
                  a == 'reject'
                      ? OutlinedButton(onPressed: _busy ? null : () => _withReason('reject', 'Return to lecturer', lock), child: Text(labels[a]!))
                      : a == 'request_correction'
                          ? OutlinedButton(onPressed: _busy ? null : () => _withReason('request_correction', 'Request correction', lock), child: Text(labels[a]!))
                          : FilledButton(onPressed: _busy ? null : () => _act(a, lock), child: Text(labels[a]!)),
              ]),
            if (actions.contains('request_correction')) Text('Corrections: use the web app to open a new version after requesting one.', style: Theme.of(context).textTheme.bodySmall),
          ]);
        },
      ),
    );
  }
}
