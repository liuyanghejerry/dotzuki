#!/usr/bin/env python3
"""Build and run the native touch regression harness in an isolated exported Android host."""
import argparse
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', type=Path, required=True, help='exported host with a game pack and matching runtime')
    parser.add_argument('--serial', required=True, help='adb emulator/device serial')
    parser.add_argument('--adb', default='adb')
    parser.add_argument('--gradle', default='gradle')
    args = parser.parse_args()
    workspace = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='dotzuki-touch-test-') as directory:
        project = Path(directory)
        shutil.copytree(args.project, project, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('build', '.gradle', '.cxx', '.idea'))
        manifest = project / 'app/build.gradle.kts'
        body = manifest.read_text()
        body, count = re.subn(r'applicationId\s*=\s*"[^"]+"',
                             'applicationId = "com.dotzuki.touchregression"', body)
        if count != 1:
            raise ValueError('expected one literal applicationId in exported build.gradle.kts')
        body = re.sub(r'\s*testInstrumentationRunner\s*=\s*"[^"]+"', '', body)
        body = body.replace('defaultConfig {', 'defaultConfig {\n        '
                            'testInstrumentationRunner = "com.dotzuki.player.TouchInstrumentation"', 1)
        manifest.write_text(body)
        test = project / 'app/src/androidTest/java/com/dotzuki/player/TouchInstrumentation.java'
        test.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(workspace / 'crates/dotzuki-mobile/controls/tests/android/TouchInstrumentation.java', test)
        subprocess.run([args.gradle, '--project-dir', str(project), ':app:assembleDebug',
                        ':app:assembleDebugAndroidTest', '--console=plain'], check=True)
        adb = [args.adb, '-s', args.serial]
        for apk in ['debug/app-debug.apk', 'androidTest/debug/app-debug-androidTest.apk']:
            subprocess.run(adb + ['install', '-r', str(project / 'app/build/outputs/apk' / apk)], check=True)
        output = subprocess.run(adb + ['shell', 'am', 'instrument', '-w',
                                'com.dotzuki.touchregression.test/com.dotzuki.player.TouchInstrumentation'],
                                capture_output=True, text=True, check=True)
        print(output.stdout)
        if 'PASS: full-window overlay' not in output.stdout:
            raise RuntimeError('native touch regression failed; inspect adb logcat')


if __name__ == '__main__':
    main()
