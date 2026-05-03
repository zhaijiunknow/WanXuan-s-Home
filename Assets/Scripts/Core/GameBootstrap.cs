using UnityEngine;
using UnityEngine.SceneManagement;

public class GameBootstrap : MonoBehaviour
{
    [SerializeField] private string mainSceneName = "MainRoom";

    private void Start()
    {
        if (SceneManager.GetActiveScene().name == mainSceneName)
        {
            return;
        }

        SceneManager.LoadScene(mainSceneName);
    }
}
