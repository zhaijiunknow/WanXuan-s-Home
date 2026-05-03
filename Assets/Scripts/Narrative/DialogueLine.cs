using System;
using UnityEngine;

[Serializable]
public class DialogueLine
{
    [SerializeField] private string speakerName;
    [SerializeField] [TextArea(2, 4)] private string content;
    [SerializeField] private string expressionId;
    [SerializeField] private TimeOfDay background;
    [SerializeField] private AudioClip soundEffect;

    public string SpeakerName => speakerName;
    public string Content => content;
    public string ExpressionId => expressionId;
    public TimeOfDay Background => background;
    public AudioClip SoundEffect => soundEffect;
}
