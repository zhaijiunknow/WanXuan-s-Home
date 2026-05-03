using UnityEngine;

public class EnvironmentManager : MonoBehaviour
{
    [SerializeField] private BackgroundController backgroundController;

    private GameManager gameManager;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;
    }

    public void SetBackground(TimeOfDay timeOfDay)
    {
        backgroundController.SetTimeOfDay(timeOfDay);
    }
}
