export async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case 'wrap': {
      const dashIdx = rest.indexOf('--');
      const wrapOpts = dashIdx >= 0 ? rest.slice(0, dashIdx) : [];
      const cmdArgs = dashIdx >= 0 ? rest.slice(dashIdx + 1) : rest;

      let debugCaptureFilter: string | undefined;
      let ui = true;
      let uiPort: number | undefined;
      for (let i = 0; i < wrapOpts.length; i++) {
        if (wrapOpts[i] === '--debug-capture-filter') debugCaptureFilter = wrapOpts[++i];
        else if (wrapOpts[i] === '--no-ui') ui = false;
        else if (wrapOpts[i] === '--ui-port') uiPort = Number(wrapOpts[++i]);
      }

      if (
        uiPort !== undefined &&
        (!Number.isInteger(uiPort) || uiPort <= 0 || uiPort > 65535)
      ) {
        console.error(`token-profiler: invalid --ui-port '${uiPort}'`);
        process.exitCode = 1;
        return;
      }
      if (uiPort !== undefined && !ui) {
        console.error('token-profiler: --ui-port cannot be combined with --no-ui');
        process.exitCode = 1;
        return;
      }

      const { runWrap } = await import('./wrap.ts');
      await runWrap(cmdArgs, { debugCaptureFilter, ui, uiPort });
      return;
    }
    case 'report': {
      const { runReport } = await import('./report.ts');
      runReport(rest);
      return;
    }
    case 'ui': {
      let port = 7331;
      let dbPath: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--port') port = Number(rest[++i]);
        else if (rest[i] === '--db') dbPath = rest[++i];
      }
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        console.error(`token-profiler: invalid --port '${port}'`);
        process.exitCode = 1;
        return;
      }
      const { startUiServer, uiClientBuilt, UI_NOT_BUILT_MESSAGE } = await import('./ui/server.ts');
      if (!uiClientBuilt()) {
        // Source checkout without `npm run build` (ADR-0015 decision 5). The
        // `ui` command has nothing to serve, so fail fast.
        console.error(UI_NOT_BUILT_MESSAGE);
        process.exitCode = 1;
        return;
      }
      await startUiServer({ port, dbPath });
      return;
    }
    case 'debug-capture': {
      const [sub, ...subArgs] = rest;
      const { runDebugCaptureList, runDebugCapturePurge } = await import('./debug-capture.ts');
      if (sub === 'list') {
        await runDebugCaptureList(subArgs);
      } else if (sub === 'purge') {
        await runDebugCapturePurge(subArgs);
      } else {
        console.error(
          [
            `token-profiler: unknown debug-capture subcommand '${sub ?? ''}'`,
            '',
            'Subcommands:',
            '  debug-capture list [--task <task_id>]',
            '  debug-capture purge (--task <task_id> | --all) [--older-than-days N]',
          ].join('\n')
        );
        process.exitCode = 1;
      }
      return;
    }
    default:
      console.error(
        [
          `token-profiler: unknown command '${cmd ?? ''}'`,
          '',
          'Commands:',
          '  wrap [--debug-capture-filter <spec>] [--no-ui] [--ui-port N] -- <command> [args...]',
          '                                 Run a command under observation (one Task).',
          '                                 Also starts the local UI on 127.0.0.1:7331',
          '                                 (joins an existing one if the port is taken);',
          '                                 --ui-port overrides that port, --no-ui skips it.',
          '                                 --debug-capture-filter is an opt-in, scoped',
          '                                 diagnostic capture — see docs/adr/0012.',
          '  report <task_id>              Print UCV/CTV/Context Amplification/Exact Reuse for a Task.',
          '  ui [--port N] [--db PATH]     Local browser view of the profiler DB (read + task delete).',
          '  debug-capture list|purge      Manage captures made with --debug-capture-filter.',
        ].join('\n')
      );
      process.exitCode = 1;
  }
}
