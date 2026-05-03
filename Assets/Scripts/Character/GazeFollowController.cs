using UnityEngine;
using UnityEngine.InputSystem;

public class GazeFollowController : MonoBehaviour
{
    [SerializeField] private WanXuanLive2DController characterController;
    [SerializeField] private Camera targetCamera;
    [SerializeField] private float maxX = 20f;
    [SerializeField] private float maxY = 12f;
    [SerializeField] private float smoothSpeed = 8f;

    private float currentAngleX;
    private float currentAngleY;

    private void Awake()
    {
        if (targetCamera == null)
        {
            targetCamera = Camera.main;
        }
    }

    private void Update()
    {
        if (characterController == null || targetCamera == null || Mouse.current == null)
        {
            return;
        }

        var viewport = targetCamera.ScreenToViewportPoint(Mouse.current.position.ReadValue());
        var targetAngleX = Mathf.Lerp(-maxX, maxX, viewport.x);
        var targetAngleY = Mathf.Lerp(-maxY, maxY, viewport.y);

        currentAngleX = Mathf.Lerp(currentAngleX, targetAngleX, Time.deltaTime * smoothSpeed);
        currentAngleY = Mathf.Lerp(currentAngleY, targetAngleY, Time.deltaTime * smoothSpeed);

        characterController.SetLookAngles(currentAngleX, currentAngleY);
    }
}
