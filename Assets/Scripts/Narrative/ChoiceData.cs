using System;
using UnityEngine;

[Serializable]
public class ChoiceOption
{
    [SerializeField] private string label;
    [SerializeField] private string nextStepId;

    public string Label => label;
    public string NextStepId => nextStepId;
}
