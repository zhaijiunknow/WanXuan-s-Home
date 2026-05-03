using UnityEngine;

public class CharacterManager : MonoBehaviour
{
    [SerializeField] private WanXuanLive2DController wanXuanController;

    private GameManager gameManager;

    public void Initialize(GameManager owner)
    {
        gameManager = owner;
    }

    public void SetExpression(string expressionId)
    {
        wanXuanController.SetExpression(expressionId);
    }

    public void SetLookAngles(float angleX, float angleY)
    {
        wanXuanController.SetLookAngles(angleX, angleY);
    }

    public void SetMouthOpen(float value)
    {
        wanXuanController.SetMouthOpen(value);
    }
}
