const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// List of optional dependencies from @vue/compiler-sfc that we can safely ignore.
const problematicDeps = [
    'velocityjs', 'dustjs-linkedin', 'atpl', 'liquor', 'twig', 'ejs',
    'eco', 'jazz', 'jqtpl', 'hamljs', 'hamlet', 'whiskers', 'haml-coffee',
    'hogan.js', 'templayed', 'handlebars', 'underscore', 'lodash', 'walrus',
    'mustache', 'just', 'ect', 'mote', 'toffee', 'dot', 'bracket-template',
    'ractive', 'htmling', 'babel-core', 'plates', 'react-dom/server', 'react',
    'vash', 'slm', 'marko', 'teacup/lib/express', 'coffee-script',
    'squirrelly', 'twing'
];

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode', ...problematicDeps],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
