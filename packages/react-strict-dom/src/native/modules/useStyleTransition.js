/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 */

import type {
  Style as ReactNativeStyle,
  StyleValue,
  Transform
} from '../../types/react-native';

import { useEffect, useRef, useState } from 'react';
import { warnMsg } from '../../shared/logUtils';
import { Animated, Easing } from 'react-native';

type AnimatedStyle = { [string]: ?StyleValue | $ReadOnlyArray<mixed> };

type TransitionMetadata = $ReadOnly<{
  delay: number,
  duration: number,
  timingFunction: string | null,
  shouldUseNativeDriver: boolean
}>;

const INPUT_RANGE: $ReadOnlyArray<number> = [0, 1];

function isNumber(num: mixed): num is number {
  return typeof num === 'number';
}

function isString(str: mixed): str is string {
  return typeof str === 'string';
}

function canUseNativeDriver(
  transitionProperties: ReactNativeStyle | void
): boolean {
  if (transitionProperties === undefined) {
    return false;
  }
  for (const property in transitionProperties) {
    const value = transitionProperties?.[property];
    if (property === 'opacity') {
      continue;
    }
    if (
      property === 'transform' &&
      Array.isArray(value) &&
      !value.includes('skew')
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function getEasingFunction(input: ?string) {
  if (input === 'ease') {
    return Easing.ease;
  } else if (input === 'ease-in') {
    return Easing.in(Easing.ease);
  } else if (input === 'ease-out') {
    return Easing.out(Easing.ease);
  } else if (input === 'ease-in-out') {
    return Easing.inOut(Easing.ease);
  } else if (input != null && input.includes('cubic-bezier')) {
    const chunk = input.split('cubic-bezier(')[1];
    const str = chunk.split(')')[0];
    const curve = str.split(',').map((point) => parseFloat(point.trim()));
    return Easing.bezier(...curve);
  }
  return Easing.linear;
}

function getTransitionProperties(property: mixed): ?(string[]) {
  if (property === 'all') {
    return ['opacity', 'transform'];
  }
  if (typeof property === 'string') {
    return property.split(',').map((p) => p.trim());
  }
  return null;
}

function transformsHaveSameLengthTypesAndOrder(
  transformsA: $ReadOnlyArray<Transform>,
  transformsB: $ReadOnlyArray<Transform>
): boolean {
  if (transformsA.length !== transformsB.length) {
    return false;
  }
  for (let i = 0; i < transformsA.length; i++) {
    if (
      (transformsA[i].perspective != null &&
        transformsB[i].perspective == null) ||
      (transformsA[i].rotate != null && transformsB[i].rotate == null) ||
      (transformsA[i].rotateX != null && transformsB[i].rotateX == null) ||
      (transformsA[i].rotateY != null && transformsB[i].rotateY == null) ||
      (transformsA[i].rotateZ != null && transformsB[i].rotateZ == null) ||
      (transformsA[i].scale != null && transformsB[i].scale == null) ||
      (transformsA[i].scaleX != null && transformsB[i].scaleX == null) ||
      (transformsA[i].scaleY != null && transformsB[i].scaleY == null) ||
      (transformsA[i].scaleZ != null && transformsB[i].scaleZ == null) ||
      (transformsA[i].skewX != null && transformsB[i].skewX == null) ||
      (transformsA[i].skewY != null && transformsB[i].skewY == null) ||
      (transformsA[i].translateX != null &&
        transformsB[i].translateX == null) ||
      (transformsA[i].translateY != null && transformsB[i].translateY == null)
    ) {
      return false;
    }
  }
  return true;
}

function transformListsAreEqual(
  transformsA: $ReadOnlyArray<Transform>,
  transformsB: $ReadOnlyArray<Transform>
): boolean {
  if (!transformsHaveSameLengthTypesAndOrder(transformsA, transformsB)) {
    return false;
  }
  for (let i = 0; i < transformsA.length; i++) {
    const tA = transformsA[i];
    const tB = transformsB[i];
    if (
      (tA.perspective != null && tA.perspective !== tB.perspective) ||
      (tA.rotate != null && tA.rotate !== tB.rotate) ||
      (tA.rotateX != null && tA.rotateX !== tB.rotateX) ||
      (tA.rotateY != null && tA.rotateY !== tB.rotateY) ||
      (tA.rotateZ != null && tA.rotateZ !== tB.rotateZ) ||
      (tA.scale != null && tA.scale !== tB.scale) ||
      (tA.scaleX != null && tA.scaleX !== tB.scaleX) ||
      (tA.scaleY != null && tA.scaleY !== tB.scaleY) ||
      (tA.scaleZ != null && tA.scaleZ !== tB.scaleZ) ||
      (tA.skewX != null && tA.skewX !== tB.skewX) ||
      (tA.skewY != null && tA.skewY !== tB.skewY) ||
      (tA.translateX != null && tA.translateX !== tB.translateX) ||
      (tA.translateY != null && tA.translateY !== tB.translateY)
    ) {
      return false;
    }
  }
  return true;
}

function transitionStyleHasChanged(
  next: ReactNativeStyle | void,
  prev: ReactNativeStyle | void
): boolean {
  if (next === undefined) {
    return false;
  }

  if (typeof prev !== typeof next) {
    return true;
  }

  if (prev !== undefined && next !== undefined) {
    for (const propKey in next) {
      const prevValue = prev[propKey];
      const nextValue = next[propKey];

      // handle type differences
      if (typeof prevValue !== typeof nextValue) {
        return true;
      }

      // handle transform value differences
      else if (
        Array.isArray(prevValue) &&
        Array.isArray(nextValue) &&
        !transformListsAreEqual(prevValue, nextValue)
      ) {
        return true;
      }

      // handle literal value differences
      else if (prevValue !== nextValue) {
        return true;
      }
    }
  }
  return false;
}

export function useStyleTransition(style: ReactNativeStyle): ReactNativeStyle {
  const {
    transitionDelay: _delay,
    transitionDuration: _duration,
    transitionProperty: _transitionProperty,
    transitionTimingFunction: _timingFunction,
    ...styleWithAnimations
  } = style;

  const transitionDelay = isNumber(_delay) ? _delay : 0;
  const transitionDuration = isNumber(_duration) ? _duration : 16;
  const transitionTimingFunction = isString(_timingFunction)
    ? _timingFunction
    : null;

  const transitionStyle = getTransitionProperties(
    _transitionProperty
  )?.reduce<ReactNativeStyle>((output, property) => {
    const value = style[property];
    if (isString(value) || isNumber(value) || Array.isArray(value)) {
      output[property] = value;
    }
    return output;
  }, {});

  const [currentStyle, setCurrentStyle] = useState<ReactNativeStyle | void>(
    style
  );
  const [previousStyle, setPreviousStyle] = useState<ReactNativeStyle | void>(
    undefined
  );

  const [animatedValue, setAnimatedValue] = useState<Animated.Value | void>(
    undefined
  );

  // This ref is utilized as a performance optimization so that the effect that contains the
  // animation trigger only is called when the animated value's identity changes. As far as the effect
  // is concerned it just needs the most up to date version of these transition properties;
  const transitionMetadataRef = useRef<TransitionMetadata>({
    delay: transitionDelay,
    duration: transitionDuration,
    timingFunction: transitionTimingFunction,
    shouldUseNativeDriver: canUseNativeDriver(transitionStyle)
  });
  // effect to sync the transition metadata
  useEffect(() => {
    transitionMetadataRef.current = {
      delay: transitionDelay,
      duration: transitionDuration,
      timingFunction: transitionTimingFunction,
      shouldUseNativeDriver: canUseNativeDriver(transitionStyle)
    };
  }, [
    transitionDelay,
    transitionDuration,
    transitionStyle,
    transitionTimingFunction
  ]);

  // effect to trigger a transition
  // REMEMBER: it is super important that this effect's dependency array **only** contains the animated value
  useEffect(() => {
    if (animatedValue !== undefined) {
      const { delay, duration, timingFunction, shouldUseNativeDriver } =
        transitionMetadataRef.current;

      const animation = Animated.sequence([
        Animated.delay(delay),
        Animated.timing(animatedValue, {
          toValue: 1,
          duration,
          easing: getEasingFunction(timingFunction),
          useNativeDriver: shouldUseNativeDriver
        })
      ]);
      animation.start();

      return () => {
        animation.stop();
      };
    }
  }, [animatedValue]);

  if (transitionStyleHasChanged(transitionStyle, currentStyle)) {
    setCurrentStyle(style);
    setPreviousStyle(currentStyle);
    setAnimatedValue(new Animated.Value(0));
    // This commit will be thrown away due to the above state setters so we can bail out early
    return style;
  }

  if (transitionStyle === undefined) {
    return style;
  }

  const outputAnimatedStyle: AnimatedStyle = Object.entries(
    transitionStyle
  ).reduce<AnimatedStyle>((animatedStyle, [property, value]) => {
    const startValue = previousStyle?.[property] ?? value;

    if (animatedValue === undefined || startValue === value) {
      animatedStyle[property] = value;
    } else if (typeof value === 'number') {
      animatedStyle[property] = animatedValue.interpolate({
        inputRange: INPUT_RANGE,
        outputRange: [+startValue, value]
      });
      return animatedStyle;
    } else if (typeof value === 'string') {
      animatedStyle[property] = animatedValue.interpolate({
        inputRange: INPUT_RANGE,
        outputRange: [String(startValue), value]
      });
      return animatedStyle;
    } else if (property === 'transform' && Array.isArray(value)) {
      const transforms = value;
      const refTransforms = startValue;

      // Check that there are the same number of transforms
      if (
        !Array.isArray(refTransforms) ||
        transforms.length !== refTransforms.length
      ) {
        if (__DEV__) {
          warnMsg(
            'The number or types of transforms must be the same before and after the transition. The transition will not animate.'
          );
        }
        animatedStyle[property] = transforms;
        return animatedStyle;
      }

      // TODO: Figure out how to animate matrix transforms
      for (const transform of transforms) {
        if (transform.matrix != null) {
          if (__DEV__) {
            warnMsg(
              'Matrix transforms cannot be animated. The transition will not animate.'
            );
          }
          animatedStyle[property] = transforms;
          return animatedStyle;
        }
      }

      // Check that the transforms have the same types in the same order
      if (!transformsHaveSameLengthTypesAndOrder(transforms, refTransforms)) {
        if (__DEV__) {
          warnMsg(
            'The types of transforms must be the same before and after the transition. The transition will not animate.\n' +
              `Before: ${JSON.stringify(transforms)}\n` +
              `After: ${JSON.stringify(refTransforms)}`
          );
        }
        animatedStyle[property] = transforms;
        return animatedStyle;
      }

      // Animate the transforms
      const animatedTransforms: Array<mixed> = [];
      for (let i = 0; i < transforms.length; i++) {
        const singleTransform = transforms[i];
        const singleRefTransform = refTransforms[i];

        if (singleTransform.perspective != null) {
          animatedTransforms.push({
            perspective: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [
                +singleRefTransform.perspective,
                singleTransform.perspective
              ]
            })
          });
          continue;
        }
        if (
          singleRefTransform.rotate != null &&
          singleTransform.rotate != null
        ) {
          animatedTransforms.push({
            rotate: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [singleRefTransform.rotate, singleTransform.rotate]
            })
          });
          continue;
        }
        if (
          singleRefTransform.rotateX != null &&
          singleTransform.rotateX != null
        ) {
          animatedTransforms.push({
            rotateX: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [singleRefTransform.rotateX, singleTransform.rotateX]
            })
          });
          continue;
        }
        if (
          singleRefTransform.rotateY != null &&
          singleTransform.rotateY != null
        ) {
          animatedTransforms.push({
            rotateY: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [singleRefTransform.rotateY, singleTransform.rotateY]
            })
          });
          continue;
        }
        if (
          singleRefTransform.rotateZ != null &&
          singleTransform.rotateZ != null
        ) {
          animatedTransforms.push({
            rotateZ: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [singleRefTransform.rotateZ, singleTransform.rotateZ]
            })
          });
          continue;
        }
        if (singleTransform.scale != null) {
          animatedTransforms.push({
            scale: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [+singleRefTransform.scale, singleTransform.scale]
            })
          });
          continue;
        }
        if (singleTransform.scaleX != null) {
          animatedTransforms.push({
            scaleX: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [+singleRefTransform.scaleX, singleTransform.scaleX]
            })
          });
          continue;
        }
        if (singleTransform.scaleY != null) {
          animatedTransforms.push({
            scaleY: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [+singleRefTransform.scaleY, singleTransform.scaleY]
            })
          });
          continue;
        }
        if (singleTransform.scaleZ != null) {
          animatedTransforms.push({
            scaleZ: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [+singleRefTransform.scaleZ, singleTransform.scaleZ]
            })
          });
          continue;
        }
        if (singleRefTransform.skewX != null && singleTransform.skewX != null) {
          animatedTransforms.push({
            skewX: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [singleRefTransform.skewX, singleTransform.skewX]
            })
          });
          continue;
        }
        if (singleRefTransform.skewY != null && singleTransform.skewY != null) {
          animatedTransforms.push({
            skewY: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [singleRefTransform.skewY, singleTransform.skewY]
            })
          });
          continue;
        }
        if (
          singleRefTransform.translateX != null &&
          singleTransform.translateX != null
        ) {
          animatedTransforms.push({
            translateX: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [
                +singleRefTransform.translateX,
                singleTransform.translateX
              ]
            })
          });
          continue;
        }
        if (
          singleRefTransform.translateY != null &&
          singleTransform.translateY != null
        ) {
          animatedTransforms.push({
            translateY: animatedValue.interpolate({
              inputRange: INPUT_RANGE,
              outputRange: [
                +singleRefTransform.translateY,
                singleTransform.translateY
              ]
            })
          });
          continue;
        }
      }
      animatedStyle[property] = animatedTransforms;
      return animatedStyle;
    }

    return animatedStyle;
  }, {});

  Object.assign(styleWithAnimations, outputAnimatedStyle);

  return styleWithAnimations;
}
