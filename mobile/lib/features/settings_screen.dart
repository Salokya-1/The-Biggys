import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/auth.dart';
import '../core/config.dart';
import '../widgets/common.dart';

/// Lets the demo point at the deployed API or a laptop on the venue Wi-Fi.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});
  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _url = TextEditingController();
  String? _status;

  @override
  void initState() {
    super.initState();
    AppSettings.apiBaseUrl().then((v) => setState(() => _url.text = v));
  }

  Future<void> _save() async {
    await AppSettings.setApiBaseUrl(_url.text);
    ref.invalidate(apiBaseUrlProvider);
    final ok = await ApiClient(_url.text.trim()).healthy();
    setState(() => _status = ok ? 'Connected: API is healthy' : 'Saved, but the API did not answer /health');
    await ref.read(authProvider.notifier).reinit();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings'), actions: const [AppBarLogo()]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        const Text('API base URL', style: TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 6),
        TextField(controller: _url, decoration: const InputDecoration(hintText: 'https://…'), keyboardType: TextInputType.url, autocorrect: false),
        const SizedBox(height: 6),
        Text('Default: $kDefaultApiUrl. Use http://<laptop-ip>:8080 for a local demo.', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 12),
        Row(children: [
          FilledButton(onPressed: _save, child: const Text('Save & test')),
          const SizedBox(width: 12),
          OutlinedButton(
            onPressed: () async {
              _url.text = kDefaultApiUrl;
              await _save();
            },
            child: const Text('Reset'),
          ),
        ]),
        if (_status != null) ...[const SizedBox(height: 12), Text(_status!)],
        const SizedBox(height: 24),
        TextButton(onPressed: () => context.pop(), child: const Text('Back')),
      ]),
    );
  }
}
