const esbuild = require('esbuild');
const chokidar = require('chokidar');

const isWatch = process.argv.includes('--watch');

const commonConfig = {
  bundle: true,
  sourcemap: true,
  target: ['chrome100'],
  format: 'iife',
  logLevel: 'info',
};

const buildConfigs = [
  {
    ...commonConfig,
    entryPoints: ['src/background/index.js'],
    outfile: 'dist/background.js',
  },
  {
    ...commonConfig,
    entryPoints: ['src/content/index.js'],
    outfile: 'dist/content-script.js',
  },
];

async function build() {
  try {
    for (const config of buildConfigs) {
      await esbuild.build(config);
    }
    console.log('✅ Build complete!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

async function watch() {
  await build();

  const watcher = chokidar.watch('src/**/*.js', {
    ignored: /node_modules/,
    persistent: true
  });

  watcher.on('change', async (filePath) => {
    console.log(`\n📝 File changed: ${filePath}`);
    await build();
  });

  console.log('\n👀 Watching for changes...');
}

if (isWatch) {
  watch();
} else {
  build();
}
