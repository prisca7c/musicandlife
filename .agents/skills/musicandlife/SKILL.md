```markdown
# musicandlife Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development conventions and patterns found in the `musicandlife` TypeScript codebase. It covers file organization, code style, commit practices, and how to write and run tests. By following these guidelines, contributors can maintain consistency and quality throughout the project.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `audioPlayer.ts`, `userProfile.ts`

### Import Style
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { playTrack } from './audioPlayer';
    ```

### Export Style
- Use **named exports** for all exported functions, types, or constants.
  - Example:
    ```typescript
    // audioPlayer.ts
    export function playTrack(trackId: string) { ... }
    export const DEFAULT_VOLUME = 0.8;
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `fix` prefix for bug fixes.
- Keep commit messages concise (average ~65 characters).
  - Example:
    ```
    fix: corrects playback issue when switching tracks
    ```

## Workflows

_No automated workflows detected in this repository._

## Testing Patterns

- Test files use the pattern: `*.test.*` (e.g., `audioPlayer.test.ts`)
- Testing framework is **unknown**; check existing test files for conventions.
- Example test file structure:
  ```typescript
  // audioPlayer.test.ts
  import { playTrack } from './audioPlayer';

  describe('playTrack', () => {
    it('should play the correct track', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command | Purpose |
|---------|---------|
| /test   | Run all test files matching `*.test.*` |
| /commit | Make a conventional commit (e.g., `fix: ...`) |
```