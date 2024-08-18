import type {ArgumentsCamelCase} from 'yargs';
import type {TimerShimStrategy} from '../testing/compile';
import {compilePackBundle} from '../testing/compile';
import {print} from '../testing/helpers';
import {importManifest} from './helpers';
import {PackVersionDefinition} from '../types';
import * as fs from 'fs';
import * as path from 'path';
interface BuildArgs {
  manifestFile: string;
  outputDir?: string;
  minify: boolean;
  timerStrategy: TimerShimStrategy;
  intermediateOutputDirectory?: string;
}

export async function handleBuild({
  outputDir,
  manifestFile,
  minify,
  timerStrategy,
  intermediateOutputDirectory,
}: ArgumentsCamelCase<BuildArgs>) {
  print(outputDir);
  print('HERE!');
  const {bundlePath, intermediateOutputDirectory: actualIntermediateOutputDirectory} = await compilePackBundle({
    manifestPath: manifestFile,
    minify,
    outputDirectory: outputDir,
    timerStrategy,
    intermediateOutputDirectory,
  });
  if (outputDir) {
    print(
      `Pack built successfully. Compiled output is in ${bundlePath}. Intermediate files are in ${actualIntermediateOutputDirectory}`,
    );
  } else {
    print(`Pack built successfully. Compiled output is in ${bundlePath}.`);
  }
  const manifest = await importManifest<PackVersionDefinition>(bundlePath);
  // write manifest as json to a file
  const manifestPath = outputDir ? path.join(outputDir, 'manifest.json') : 'manifest.json';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  print(`Manifest written to ${manifestPath}`);
}

export async function build(
  manifestFile: string,
  {timerStrategy}: {timerStrategy?: TimerShimStrategy} = {},
): Promise<string> {
  const {bundlePath} = await compilePackBundle({
    manifestPath: manifestFile,
    timerStrategy,
  });

  return bundlePath;
}
