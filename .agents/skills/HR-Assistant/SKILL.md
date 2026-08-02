```markdown
# HR-Assistant Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the HR-Assistant repository, a TypeScript backend application built with the Express framework. You'll learn how to structure files, write imports and exports, follow commit message patterns, and implement and test features in line with the project's standards.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `userController.ts`, `employeeService.ts`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { getUser } from './userService';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // userService.ts
    export function getUser(id: string) { ... }
    export function createUser(data: User) { ... }
    ```

### Commit Message Patterns
- Commit messages are **freeform** with no strict prefix, but are concise (average 41 characters).
  - Example:  
    ```
    Add endpoint for employee onboarding
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new endpoint or service.
**Command:** `/add-feature`

1. Create a new file in camelCase (e.g., `employeeController.ts`).
2. Use relative imports to include any dependencies.
3. Export your functions using named exports.
4. Write a corresponding test file named `employeeController.test.ts`.
5. Commit your changes with a concise, descriptive message.

   ```typescript
   // employeeController.ts
   import { addEmployee } from './employeeService';

   export function createEmployee(req, res) {
     // implementation
   }
   ```

### Refactoring Code
**Trigger:** When improving or reorganizing existing code.
**Command:** `/refactor`

1. Identify the code to refactor.
2. Rename files using camelCase if needed.
3. Update all relative imports accordingly.
4. Ensure all exports remain named.
5. Run tests to verify nothing is broken.
6. Commit with a clear message describing the refactor.

### Writing Tests
**Trigger:** When adding or updating features.
**Command:** `/write-test`

1. Create a test file with the pattern `*.test.ts` (e.g., `userService.test.ts`).
2. Write tests for each exported function.
3. Use the project's preferred (unknown) testing framework.
4. Run tests to ensure correctness.
5. Commit with a message like "Add tests for userService".

## Testing Patterns

- Test files are named with the pattern `*.test.ts`.
- Each test file should correspond to a module and test all named exports.
- The specific testing framework is not specified, but follow standard TypeScript testing practices.

  ```typescript
  // userService.test.ts
  import { getUser } from './userService';

  describe('getUser', () => {
    it('should return user by id', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command        | Purpose                                   |
|----------------|-------------------------------------------|
| /add-feature   | Scaffold and implement a new feature      |
| /refactor      | Refactor existing code                    |
| /write-test    | Create and run tests for a module         |
```