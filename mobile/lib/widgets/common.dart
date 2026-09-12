import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

String fmtDate(String? iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse(iso);
  return d == null ? iso : DateFormat('EEE d MMM yyyy').format(d.toLocal());
}

String fmtDateTime(String? iso) {
  if (iso == null) return '—';
  final d = DateTime.tryParse(iso);
  return d == null ? iso : DateFormat('d MMM, HH:mm').format(d.toLocal());
}

/// "Offline · last synced 12:04" strip shown when a screen is serving cached data.
class StaleBanner extends StatelessWidget {
  const StaleBanner({super.key, required this.stale, this.syncedAt});
  final bool stale;
  final DateTime? syncedAt;
  @override
  Widget build(BuildContext context) {
    if (!stale) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: Colors.amber.shade100,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Text(
        'Offline · showing data last synced ${syncedAt == null ? 'earlier' : DateFormat('d MMM HH:mm').format(syncedAt!.toLocal())}',
        style: TextStyle(color: Colors.amber.shade900, fontSize: 12),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.subtitle});
  final IconData icon;
  final String title;
  final String? subtitle;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 44, color: Theme.of(context).colorScheme.outline),
          const SizedBox(height: 12),
          Text(title, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          if (subtitle != null) ...[const SizedBox(height: 4), Text(subtitle!, style: Theme.of(context).textTheme.bodySmall, textAlign: TextAlign.center)],
        ]),
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.cloud_off, size: 44, color: Theme.of(context).colorScheme.error),
          const SizedBox(height: 12),
          Text(message, textAlign: TextAlign.center),
          if (onRetry != null) ...[const SizedBox(height: 12), FilledButton.tonal(onPressed: onRetry, child: const Text('Retry'))],
        ]),
      ),
    );
  }
}

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.color});
  final String text;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.secondaryContainer;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(999)),
      child: Text(text, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

Color outcomeColor(String? outcome) => switch (outcome) {
      'PASS' => Colors.green.shade100,
      'FAIL' => Colors.red.shade100,
      'RESIT' => Colors.amber.shade100,
      'DEFERRED' => Colors.grey.shade300,
      _ => Colors.grey.shade200,
    };

Color statusColor(String status) => switch (status) {
      'DRAFT' => Colors.grey.shade300,
      'SUBMITTED' => Colors.lightBlue.shade100,
      'UNDER_REVIEW' => Colors.deepPurple.shade100,
      'APPROVED' => Colors.teal.shade100,
      'PUBLISHED' => Colors.green.shade100,
      _ => Colors.amber.shade100,
    };

/// Room grid with the student's seat highlighted. Front of the room at the top.
class MiniSeatGrid extends StatelessWidget {
  const MiniSeatGrid({super.key, required this.rows, required this.cols, required this.disabled, required this.row, required this.col});
  final int rows;
  final int cols;
  final List<Map<String, dynamic>> disabled;
  final int row;
  final int col;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Column(children: [
      Text('FRONT', style: TextStyle(fontSize: 10, letterSpacing: 2, color: scheme.outline)),
      const SizedBox(height: 4),
      AspectRatio(
        aspectRatio: cols / rows,
        child: CustomPaint(painter: _GridPainter(rows: rows, cols: cols, disabled: disabled, row: row, col: col, highlight: scheme.primary, line: scheme.outlineVariant)),
      ),
    ]);
  }
}

class _GridPainter extends CustomPainter {
  _GridPainter({required this.rows, required this.cols, required this.disabled, required this.row, required this.col, required this.highlight, required this.line});
  final int rows, cols, row, col;
  final List<Map<String, dynamic>> disabled;
  final Color highlight, line;

  @override
  void paint(Canvas canvas, Size size) {
    final cw = size.width / cols;
    final ch = size.height / rows;
    final gap = (cw * 0.12).clamp(1.0, 4.0);
    final off = disabled.map((d) => '${d['row']}:${d['col']}').toSet();
    for (var r = 1; r <= rows; r++) {
      for (var c = 1; c <= cols; c++) {
        final rect = Rect.fromLTWH((c - 1) * cw + gap / 2, (r - 1) * ch + gap / 2, cw - gap, ch - gap);
        final rr = RRect.fromRectAndRadius(rect, const Radius.circular(2));
        if (r == row && c == col) {
          canvas.drawRRect(rr, Paint()..color = highlight);
        } else if (off.contains('$r:$c')) {
          canvas.drawRRect(rr, Paint()..color = line.withValues(alpha: 0.5));
        } else {
          canvas.drawRRect(rr, Paint()
            ..color = line
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1);
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _GridPainter old) => old.row != row || old.col != col || old.rows != rows || old.cols != cols;
}
