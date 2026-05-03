using System;
using Live2D.Cubism.Core;
using Live2D.Cubism.Framework.Expression;
using Live2D.Cubism.Framework.Motion;
using UnityEngine;

public class WanXuanLive2DController : MonoBehaviour
{
    [Header("Cubism")]
    [SerializeField] private CubismModel model;
    [SerializeField] private CubismExpressionController expressionController;
    [SerializeField] private CubismMotionController motionController;

    [Header("Parameters")]
    [SerializeField] private string angleXParameterId = "ParamAngleX";
    [SerializeField] private string angleYParameterId = "ParamAngleY";
    [SerializeField] private string mouthOpenParameterId = "ParamMouthOpenY";

    private CubismParameter angleXParameter;
    private CubismParameter angleYParameter;
    private CubismParameter mouthOpenParameter;

    private void Awake()
    {
        CacheParameters();
    }

    public void SetExpression(string expressionId)
    {
        if (expressionController == null || expressionController.ExpressionsList == null)
        {
            return;
        }

        var expressions = expressionController.ExpressionsList.CubismExpressionObjects;
        if (expressions == null)
        {
            return;
        }

        for (var i = 0; i < expressions.Length; i++)
        {
            var expression = expressions[i];
            if (expression == null)
            {
                continue;
            }

            if (string.Equals(expression.name, expressionId, StringComparison.OrdinalIgnoreCase))
            {
                expressionController.CurrentExpressionIndex = i;
                return;
            }
        }
    }

    public void PlayMotion(AnimationClip clip, bool loop = false)
    {
        if (motionController == null || clip == null)
        {
            return;
        }

        motionController.PlayAnimation(clip, 0, isLoop: loop);
    }

    public void SetLookAngles(float angleX, float angleY)
    {
        if (angleXParameter != null)
        {
            angleXParameter.Value = Mathf.Clamp(angleX, angleXParameter.MinimumValue, angleXParameter.MaximumValue);
        }

        if (angleYParameter != null)
        {
            angleYParameter.Value = Mathf.Clamp(angleY, angleYParameter.MinimumValue, angleYParameter.MaximumValue);
        }
    }

    public void SetMouthOpen(float value)
    {
        if (mouthOpenParameter == null)
        {
            return;
        }

        mouthOpenParameter.Value = Mathf.Clamp(value, mouthOpenParameter.MinimumValue, mouthOpenParameter.MaximumValue);
    }

    private void CacheParameters()
    {
        if (model == null)
        {
            model = GetComponentInChildren<CubismModel>();
        }

        if (expressionController == null)
        {
            expressionController = GetComponent<CubismExpressionController>();
        }

        if (motionController == null)
        {
            motionController = GetComponent<CubismMotionController>();
        }

        if (model == null)
        {
            return;
        }

        foreach (var parameter in model.Parameters)
        {
            if (parameter.Id == angleXParameterId)
            {
                angleXParameter = parameter;
            }
            else if (parameter.Id == angleYParameterId)
            {
                angleYParameter = parameter;
            }
            else if (parameter.Id == mouthOpenParameterId)
            {
                mouthOpenParameter = parameter;
            }
        }
    }
}
