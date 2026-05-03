using UnityEngine;

public class BackgroundController : MonoBehaviour
{
    [SerializeField] private GameObject dayRoot;
    [SerializeField] private GameObject eveningRoot;
    [SerializeField] private GameObject nightRoot;

    public void SetTimeOfDay(TimeOfDay timeOfDay)
    {
        SetActive(dayRoot, timeOfDay == TimeOfDay.Day);
        SetActive(eveningRoot, timeOfDay == TimeOfDay.Evening);
        SetActive(nightRoot, timeOfDay == TimeOfDay.Night);
    }

    private void SetActive(GameObject target, bool visible)
    {
        if (target != null)
        {
            target.SetActive(visible);
        }
    }
}
