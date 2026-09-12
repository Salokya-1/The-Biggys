import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/auth.dart';
import '../core/config.dart';
import '../core/theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
    setState(() {
      _error = null;
      _busy = true;
    });
    try {
      await ref.read(authProvider.notifier).login(_email.text.trim(), _password.text);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Cannot reach the server. Check the API URL in settings.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final baseUrl = ref.watch(apiBaseUrlProvider).value ?? kDefaultApiUrl;
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in'), actions: [const ThemeToggleButton(), IconButton(icon: const Icon(Icons.settings), onPressed: () => context.push('/settings'))]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Center(child: Image.asset('assets/brand/kramiq.png', height: 132, fit: BoxFit.contain)),
        const SizedBox(height: 12),
        const Text('RTE Integrated Management System', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        Text('Islington College · $baseUrl', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 20),
        TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email'), keyboardType: TextInputType.emailAddress, autocorrect: false),
        const SizedBox(height: 12),
        TextField(controller: _password, decoration: const InputDecoration(labelText: 'Password'), obscureText: true, onSubmitted: (_) => _submit()),
        if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))],
        const SizedBox(height: 16),
        FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Signing in…' : 'Sign in')),
        const SizedBox(height: 28),
        Text('Demo accounts (password $kDemoPassword)', style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: kDemoAccounts.entries
              .map((e) => OutlinedButton(
                    onPressed: () => setState(() {
                      _email.text = e.value;
                      _password.text = kDemoPassword;
                      _error = null;
                    }),
                    child: Text(e.key),
                  ))
              .toList(),
        ),
      ]),
    );
  }
}
