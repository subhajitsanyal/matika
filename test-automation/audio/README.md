# Voice harness audio assets

Acoustic test inputs for journeys whose language has no native macOS `say`
voice. Generated locally via gTTS; not checked in (see `.gitignore`).

## Bengali (PT-V2-06)

```bash
pip install gtts
python3 -c "
from gtts import gTTS
tts = gTTS(text='আমার রক্তচাপ একশো ত্রিশ বাই পঁচাশি।', lang='bn', slow=False)
tts.save('test-automation/audio/bn-IN-bp-130-85.mp3')
"
export MATIKA_BN_AUDIO=$PWD/test-automation/audio/bn-IN-bp-130-85.mp3
```

`scripts/matika-say.sh bn ...` invokes `afplay $MATIKA_BN_AUDIO`. afplay
accepts both `.mp3` and `.aiff` so no conversion needed.

**Caveat (F24, 2026-05-10).** PT-V2-06 currently fails because the Samsung
S21+ test device lacks the Soda `bn-IN` offline STT pack — the audio plays
correctly but Soda returns `LANGUAGE_NOT_SUPPORTED`. Either install the
pack manually on the device, OR resolve F25 (online STT fallback) which
makes pack absence a non-issue.

## English / Hindi

`scripts/matika-say.sh en|hi ...` uses macOS `say -v Rishi` / `say -v Lekha`
directly. No staged audio needed.
