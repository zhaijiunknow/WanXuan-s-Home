using UnityEngine;

public class AudioManager : MonoBehaviour
{
    [SerializeField] private AudioSource bgmSource;
    [SerializeField] private AudioSource seSource;

    /* 语音通道。**场景里通常没接**（这是加通道时新加的字段，而手写场景 YAML
       加组件引用是这个工程栽过跟头的地方）—— 所以没接就自己建一个。
       这样"声音页多一条语音音量"不需要动 MainRoom.unity。 */
    [SerializeField] private AudioSource voiceSource;

    private GameManager gameManager;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;

        EnsureVoiceSource();

        /* 音量是**主 × 分**两层：
             AudioListener.volume = 主音量          （由 UiSettingsStore 落）
             bgmSource.volume     = 主 × 音乐
             seSource.volume      = 主 × 音效
             voiceSource.volume   = 主 × 语音
           分成两层是因为玩家想表达的是"整体小一点，但音乐再小一点"，
           只有一个总音量做不到这件事。

           订阅而不是每帧读：设置在别的场景里被改（主菜单场景里的设置页），
           本场景的 AudioSource 也必须跟着变 —— 那是两个互不相识的场景，
           只有这个静态事件能把它们连起来。 */
        UiSettingsStore.Changed -= ApplyVolumes;
        UiSettingsStore.Changed += ApplyVolumes;

        ApplyVolumes();
    }

    /// <summary>
    /// 没有语音用的 AudioSource 就建一个。
    ///
    /// playOnAwake = false：它只在 PlayVoice 里响，不该在场景加载时自己出声。
    /// spatialBlend 保持默认 0（2D）—— 台词是对着玩家说的，不该随镜头远近变化。
    /// </summary>
    private void EnsureVoiceSource()
    {
        if (voiceSource == null)
        {
            voiceSource = gameObject.AddComponent<AudioSource>();
            voiceSource.playOnAwake = false;
            voiceSource.loop = false;
        }
    }

    private void OnDestroy()
    {
        UiSettingsStore.Changed -= ApplyVolumes;
    }

    /// <summary>把当前的音量设置作用到三条分通道上（音乐 / 音效 / 语音）。</summary>
    public void ApplyVolumes()
    {
        var settings = UiSettingsStore.Current;

        if (bgmSource != null)
        {
            bgmSource.volume = Mathf.Clamp01(settings.volume) * Mathf.Clamp01(settings.bgmVolume);
        }

        if (seSource != null)
        {
            seSource.volume = Mathf.Clamp01(settings.volume) * Mathf.Clamp01(settings.seVolume);
        }

        if (voiceSource != null)
        {
            voiceSource.volume = Mathf.Clamp01(settings.volume) * Mathf.Clamp01(settings.voiceVolume);
        }
    }

    public void PlayBgm(AudioClip clip, bool loop = true)
    {
        if (bgmSource == null || clip == null)
        {
            return;
        }

        bgmSource.clip = clip;
        bgmSource.loop = loop;
        bgmSource.Play();
    }

    public void PlaySe(AudioClip clip)
    {
        if (seSource == null || clip == null)
        {
            return;
        }

        seSource.PlayOneShot(clip);
    }

    /// <summary>
    /// 播一句台词。**现在还没有语音资源**，这个方法先备着。
    ///
    /// 以后接口型时就从这里接：口型只跟这条通道，不跟 BGM / 音效 ——
    /// 否则她会跟着背景音乐一直动嘴。做法是在播的时候按帧取
    /// `voiceSource.GetOutputData(...)` 算 RMS，喂给
    /// `CharacterManager.SetMouthOpen(value)`（那边写的是 ParamMouthOpenY）。
    /// 停播时记得归零，不然嘴会停在半开。
    /// </summary>
    public void PlayVoice(AudioClip clip)
    {
        EnsureVoiceSource();

        if (voiceSource == null || clip == null)
        {
            return;
        }

        voiceSource.PlayOneShot(clip);
    }
}
