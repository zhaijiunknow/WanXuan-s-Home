using UnityEngine;

public class AudioManager : MonoBehaviour
{
    [SerializeField] private AudioSource bgmSource;
    [SerializeField] private AudioSource seSource;

    private GameManager gameManager;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;
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
}
