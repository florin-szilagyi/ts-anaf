import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { CliError } from '../output/errors';
import { ConfigStore } from './configStore';
import { contextFileSchema, contextNameSchema } from './schemas';
import type { Context } from './types';
import { getXdgPaths, type XdgPaths } from './paths';

export class ContextService {
  private readonly paths: XdgPaths;
  private readonly config: ConfigStore;

  constructor(opts?: { paths?: XdgPaths }) {
    this.paths = opts?.paths ?? getXdgPaths();
    this.config = new ConfigStore({ paths: this.paths });
  }

  list(): Context[] {
    if (!fs.existsSync(this.paths.contextsDir)) return [];
    const entries = fs
      .readdirSync(this.paths.contextsDir)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.slice(0, -'.yaml'.length))
      .sort();
    return entries.map((name) => this.get(name));
  }

  exists(name: string): boolean {
    this.assertName(name);
    return fs.existsSync(this.paths.contextFile(name));
  }

  get(name: string): Context {
    this.assertName(name);
    const filePath = this.paths.contextFile(name);
    if (!fs.existsSync(filePath)) {
      throw new CliError({
        code: 'CONTEXT_NOT_FOUND',
        message: `Context "${name}" does not exist`,
        category: 'local_state',
        details: { name, path: filePath },
      });
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = parseYaml(raw) ?? {};
    } catch (cause) {
      throw new CliError({
        code: 'INVALID_CONTEXT_FILE',
        message: `Failed to parse context "${name}": ${(cause as Error).message}`,
        category: 'local_state',
        details: { name, path: filePath },
      });
    }
    const result = contextFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new CliError({
        code: 'INVALID_CONTEXT_FILE',
        message: `Context "${name}" failed validation: ${result.error.message}`,
        category: 'local_state',
        details: { name, path: filePath, issues: result.error.issues },
      });
    }
    return { name, ...result.data };
  }

  add(ctx: Context): Context {
    this.assertName(ctx.name);
    if (this.exists(ctx.name)) {
      throw new CliError({
        code: 'CONTEXT_EXISTS',
        message: `Context "${ctx.name}" already exists`,
        category: 'local_state',
        details: { name: ctx.name },
      });
    }
    this.writeFile(ctx);
    return ctx;
  }

  update(name: string, patch: Partial<Omit<Context, 'name'>>): Context {
    const current = this.get(name);
    const next: Context = { ...current, ...patch, name };
    this.writeFile(next);
    return next;
  }

  rename(oldName: string, newName: string): Context {
    this.assertName(newName);
    const current = this.get(oldName);
    if (oldName === newName) return current;
    if (this.exists(newName)) {
      throw new CliError({
        code: 'CONTEXT_EXISTS',
        message: `Context "${newName}" already exists`,
        category: 'local_state',
        details: { name: newName },
      });
    }
    const next: Context = { ...current, name: newName };
    this.writeFile(next);
    fs.unlinkSync(this.paths.contextFile(oldName));
    // also rename token file if present
    const oldTokenFile = this.paths.tokenFile(oldName);
    const newTokenFile = this.paths.tokenFile(newName);
    if (fs.existsSync(oldTokenFile)) {
      fs.mkdirSync(path.dirname(newTokenFile), { recursive: true });
      fs.renameSync(oldTokenFile, newTokenFile);
    }
    // update currentContext if it pointed at the old name
    if (this.config.getCurrentContext() === oldName) {
      this.config.setCurrentContext(newName);
    }
    return next;
  }

  remove(name: string): void {
    this.assertName(name);
    const filePath = this.paths.contextFile(name);
    if (!fs.existsSync(filePath)) {
      throw new CliError({
        code: 'CONTEXT_NOT_FOUND',
        message: `Context "${name}" does not exist`,
        category: 'local_state',
        details: { name },
      });
    }
    fs.unlinkSync(filePath);
    const tokenFile = this.paths.tokenFile(name);
    if (fs.existsSync(tokenFile)) {
      fs.unlinkSync(tokenFile);
    }
    if (this.config.getCurrentContext() === name) {
      this.config.setCurrentContext(undefined);
    }
  }

  /**
   * Pin the given context as the current one in the config store.
   *
   * Validates that the context exists first (via `get`) so the caller gets
   * a clean `CONTEXT_NOT_FOUND` error instead of writing a dangling pointer.
   */
  setCurrent(name: string): void {
    this.get(name);
    this.config.setCurrentContext(name);
  }

  resolve(explicit?: string): Context {
    if (explicit) {
      return this.get(explicit);
    }
    const current = this.config.getCurrentContext();
    if (!current) {
      throw new CliError({
        code: 'NO_CURRENT_CONTEXT',
        message: 'No context selected. Use `anaf-cli ctx use <name>` or pass `--context <name>`.',
        category: 'local_state',
      });
    }
    return this.get(current);
  }

  private writeFile(ctx: Context): void {
    fs.mkdirSync(this.paths.contextsDir, { recursive: true });
    const { name: _name, ...body } = ctx;
    const validated = contextFileSchema.parse(body);
    fs.writeFileSync(this.paths.contextFile(ctx.name), stringifyYaml(validated), 'utf8');
  }

  private assertName(name: string): void {
    const result = contextNameSchema.safeParse(name);
    if (!result.success) {
      throw new CliError({
        code: 'CONTEXT_NAME_INVALID',
        message: `Invalid context name "${name}": must match /^[a-z0-9][a-z0-9._-]*$/`,
        category: 'local_state',
        details: { name },
      });
    }
  }
}
