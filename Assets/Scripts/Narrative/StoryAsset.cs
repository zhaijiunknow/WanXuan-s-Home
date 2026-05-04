using UnityEngine;

[CreateAssetMenu(menuName = "WanXuan/Story Asset", fileName = "StoryAsset")]
public class StoryAsset : ScriptableObject
{
    [SerializeField] private string storyId = "main";
    [SerializeField] private string storyTitle = "Story";
    [SerializeField] private StoryStep[] steps = System.Array.Empty<StoryStep>();

    public string StoryId => storyId;
    public string StoryTitle => storyTitle;
    public StoryStep[] Steps => steps;
}
