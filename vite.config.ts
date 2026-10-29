import { defineConfig } from 'vite-plus';

export default defineConfig({
    staged: {
        '*': 'vp check --fix'
    },
    lint: { options: { typeAware: true, typeCheck: true } },
    fmt: {
        tabWidth: 4,
        semi: true,
        printWidth: 100,
        singleQuote: true,
        trailingComma: 'none',
        sortImports: {},
        sortTailwindcss: {
            attributes: ['class', 'className'],
            functions: ['clsx', 'cn', 'cva', 'tw']
        },
        sortPackageJson: true,
        ignorePatterns: [
            'pnpm-lock.yaml',
            'pnpm-workspace.yaml',
            'routeTree.gen.ts',
            '.tanstack-start/',
            '.tanstack/',
            '.cache',
            '.output',
            'dist',
            // Data written by analysis/scripts and raw downloads: kept exactly as produced, so
            // re-running the analysis shows no changes.
            'apps/website/public/data/',
            'analysis/raw/'
        ]
    }
});
