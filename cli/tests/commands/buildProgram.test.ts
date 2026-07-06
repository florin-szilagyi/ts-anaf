import { buildProgram } from '../../src/commands/buildProgram';
import { makeOutputContext } from '../../src/output';
import { getXdgPaths } from '../../src/state/paths';

function deps() {
  return { output: makeOutputContext({ format: 'text' }), services: {} as never, paths: getXdgPaths() };
}

describe('buildProgram', () => {
  it('registers all 8 top-level groups in design order', () => {
    const program = buildProgram(deps());
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(['auth', 'cred', 'efactura', 'lookup', 'ubl', 'fastbill', 'run', 'schema']);
  });

  it('attaches global flags --format, --verbose, --no-color', () => {
    const program = buildProgram(deps());
    const longs = program.options.map((o) => o.long);
    expect(longs).toEqual(expect.arrayContaining(['--format', '--verbose', '--no-color']));
  });

  it('sets the program name and version', () => {
    const program = buildProgram(deps());
    expect(program.name()).toBe('anaf-cli');
    // version is read from version.ts; just assert the helper has a version
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('every leaf command has a non-empty description', () => {
    const program = buildProgram(deps());
    function walk(cmd: import('commander').Command, path: string[]): Array<{ path: string; description: string }> {
      if (cmd.commands.length === 0) {
        return [{ path: [...path, cmd.name()].join(' '), description: cmd.description() }];
      }
      return cmd.commands.flatMap((c) => walk(c, [...path, cmd.name()]));
    }
    const leaves = program.commands.flatMap((g) => walk(g, []));
    for (const leaf of leaves) {
      expect(leaf.description.length).toBeGreaterThan(0);
    }
  });
});
