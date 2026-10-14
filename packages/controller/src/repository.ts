import { access } from "node:fs/promises";
import { resolve } from "node:path";

export interface Repository {
  key: string;
  path: string;
  defaultBranch?: string;
  /** Claude Code tool patterns permitted for sessions in this repository. */
  allowedTools?: readonly string[];
}
export interface RepositoryLookup { resolve(reference: string): Promise<Repository> }

export class RepositoryRegistry implements RepositoryLookup {
  private readonly repositories = new Map<string, Repository>();
  constructor(entries: readonly Repository[] = []) { for (const entry of entries) this.repositories.set(entry.key, { ...entry, path: resolve(entry.path) }); }
  register(repository: Repository): void { this.repositories.set(repository.key, { ...repository, path: resolve(repository.path) }); }
  async resolve(reference: string): Promise<Repository> {
    const known = this.repositories.get(reference);
    const candidate = known ?? { key: reference, path: resolve(reference) };
    await access(candidate.path);
    return { ...candidate };
  }
}
