import * as React from 'react';
import {
  StyleSheet,
  View,
  TouchableWithoutFeedback,
  ViewStyle,
  LayoutChangeEvent,
  I18nManager,
  Platform,
} from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
import Animated, { Easing } from 'react-native-reanimated';

const {
  Clock,
  Value,
  onChange,
  abs,
  add,
  and,
  block,
  call,
  clockRunning,
  cond,
  divide,
  eq,
  event,
  greaterThan,
  lessThan,
  max,
  min,
  multiply,
  neq,
  or,
  set,
  spring,
  startClock,
  stopClock,
  timing,
} = Animated;

const TRUE = 1;
const FALSE = 0;
const NOOP = 0;
const UNSET = -1;

const DIRECTION_LEFT = 1;
const DIRECTION_RIGHT = -1;

const SWIPE_DISTANCE_THRESHOLD_DEFAULT = 120;

const SWIPE_DISTANCE_MINIMUM = 15;

const SPRING_CONFIG = {
  damping: 30,
  mass: 1,
  stiffness: 250,
  overshootClamping: true,
  restSpeedThreshold: 0.001,
  restDisplacementThreshold: 0.001,
};

const TIMING_CONFIG = {
  duration: 300,
  easing: Easing.out(Easing.cubic),
};

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  locked: boolean;
  align: 'left' | 'right';
  swipeEdgeWidth: number;
  swipeDistanceThreshold?: number;
  swipeVelocityThreshold: number;
  backdropStyle?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  renderContent: (props: {
    progress: Animated.Node<number>;
  }) => React.ReactNode;
};

export default class DrawerView extends React.Component<Props> {
  static defaultProps = {
    align: I18nManager.isRTL ? 'right' : 'left',
    locked: false,
    swipeEdgeWidth: 32,
    swipeVelocityThreshold: 1000,
  };

  componentDidUpdate(prevProps: Props) {
    const {
      open,
      align,
      swipeDistanceThreshold,
      swipeVelocityThreshold,
    } = this.props;

    if (
      // Check for index in state to avoid unintended transition if component updates during swipe
      (open !== prevProps.open && open !== this.currentOpenValue) ||
      // Check if the user updated the index correctly after an update
      (typeof this.pendingOpenValue === 'boolean' &&
        open !== this.pendingOpenValue)
    ) {
      // Index in user's state is different from the index being tracked
      this.toggle(open);
    }

    // Reset the pending index
    this.pendingOpenValue = undefined;

    if (prevProps.align !== align) {
      this.drawerAlign.setValue(
        align === 'right' ? DIRECTION_RIGHT : DIRECTION_LEFT
      );
    }

    if (prevProps.swipeDistanceThreshold !== swipeDistanceThreshold) {
      this.swipeDistanceThreshold.setValue(
        swipeDistanceThreshold !== undefined
          ? swipeDistanceThreshold
          : SWIPE_DISTANCE_THRESHOLD_DEFAULT
      );
    }

    if (prevProps.swipeVelocityThreshold !== swipeVelocityThreshold) {
      this.swipeVelocityThreshold.setValue(swipeVelocityThreshold);
    }
  }

  private clock = new Clock();

  private isOpen = new Value(this.props.open ? TRUE : FALSE);
  private nextIsOpen = new Value(UNSET);
  private isSwiping = new Value(FALSE);
  private isSwipeGesture = new Value(FALSE);
  private gestureState = new Value(State.UNDETERMINED);
  private velocityX = new Value(0);
  private gestureX = new Value(0);
  private offsetX = new Value(0);
  private position = new Value(0);

  private drawerOpacity = new Value(0);
  private drawerWidth = new Value(0);
  private drawerAlign = new Value(
    this.props.align === 'right' ? DIRECTION_RIGHT : DIRECTION_LEFT
  );

  private swipeDistanceThreshold = new Value(
    this.props.swipeDistanceThreshold !== undefined
      ? this.props.swipeDistanceThreshold
      : SWIPE_DISTANCE_THRESHOLD_DEFAULT
  );
  private swipeVelocityThreshold = new Value(this.props.swipeVelocityThreshold);

  private pendingOpenValue: boolean | undefined;
  private currentOpenValue: boolean = this.props.open;

  private transitionTo = (isOpen: any) => {
    const toValue = new Value(0);
    const frameTime = new Value(0);

    const state = {
      position: this.position,
      time: new Value(0),
      finished: new Value(FALSE),
    };

    return block([
      cond(clockRunning(this.clock), NOOP, [
        // Animation wasn't running before
        // Set the initial values and start the clock
        set(toValue, multiply(isOpen, this.drawerWidth, this.drawerAlign)),
        set(frameTime, 0),
        set(state.time, 0),
        set(state.finished, FALSE),
        set(this.isOpen, isOpen),
        startClock(this.clock),
      ]),
      cond(
        this.isSwipeGesture,
        // Animate the values with a spring for swipe
        spring(
          this.clock,
          { ...state, velocity: this.velocityX },
          { ...SPRING_CONFIG, toValue }
        ),
        // Otherwise use a timing animation for faster switching
        timing(
          this.clock,
          { ...state, frameTime },
          { ...TIMING_CONFIG, toValue }
        )
      ),
      cond(state.finished, [
        // Reset gesture and velocity from previous gesture
        set(this.gestureX, 0),
        set(this.velocityX, 0),
        // When the animation finishes, stop the clock
        stopClock(this.clock),
        call([this.isOpen], ([value]: ReadonlyArray<0 | 1>) => {
          const open = Boolean(value);

          // If the mode changed, and previous animation has finished, update state
          if (open) {
            this.props.onOpen();
          } else {
            this.props.onClose();
          }

          // Without this check, the pager can go to an infinite update <-> animate loop for sync updates
          if (open !== this.props.open) {
            this.pendingOpenValue = open;

            // Force componentDidUpdate to fire, whether user does a setState or not
            // This allows us to detect when the user drops the update and revert back
            // It's necessary to make sure that the state stays in sync
            this.forceUpdate();
          }
        }),
      ]),
    ]);
  };

  private translateX = block([
    call([this.isOpen], ([value]: ReadonlyArray<0 | 1>) => {
      this.currentOpenValue = Boolean(value);
    }),
    onChange(
      this.nextIsOpen,
      cond(neq(this.nextIsOpen, UNSET), [
        // Stop any running animations
        cond(clockRunning(this.clock), stopClock(this.clock)),
        // Update the index to trigger the transition
        set(this.isOpen, this.nextIsOpen),
        set(this.nextIsOpen, UNSET),
      ])
    ),
    cond(
      eq(this.gestureState, State.ACTIVE),
      [
        cond(this.isSwiping, NOOP, [
          // We weren't dragging before, set it to true
          set(this.isSwiping, TRUE),
          set(this.isSwipeGesture, TRUE),
          // Also update the drag offset to the last position
          set(this.offsetX, this.position),
        ]),
        // Update position with previous offset + gesture distance
        set(this.position, add(this.offsetX, this.gestureX)),
        // Stop animations while we're dragging
        stopClock(this.clock),
      ],
      [
        set(this.isSwiping, FALSE),
        this.transitionTo(
          cond(
            and(
              greaterThan(abs(this.gestureX), SWIPE_DISTANCE_MINIMUM),
              or(
                greaterThan(abs(this.gestureX), this.swipeDistanceThreshold),
                greaterThan(abs(this.velocityX), this.swipeVelocityThreshold)
              )
            ),
            cond(
              // If swiped to right, open the drawer, otherwise c;ose it
              cond(
                eq(this.drawerAlign, DIRECTION_LEFT),
                greaterThan(this.gestureX, 0),
                lessThan(this.gestureX, 0)
              ),
              TRUE,
              FALSE
            ),
            this.isOpen
          )
        ),
      ]
    ),
    this.position,
  ]);

  private handleGestureEvent = event([
    {
      nativeEvent: {
        translationX: this.gestureX,
        velocityX: this.velocityX,
        state: this.gestureState,
      },
    },
  ]);

  private handleBackdropPress = () => {
    this.setState({ measured: true });
    this.isSwipeGesture.setValue(FALSE);
    this.nextIsOpen.setValue(0);
  };

  private handleLayout = (e: LayoutChangeEvent) => {
    this.drawerWidth.setValue(e.nativeEvent.layout.width);
    this.toggle(this.props.open);

    requestAnimationFrame(() => this.drawerOpacity.setValue(1));
  };

  private toggle = (open: boolean) => this.nextIsOpen.setValue(open ? 1 : 0);

  render() {
    const { open, locked, align, swipeEdgeWidth } = this.props;
    const right = align === 'right';

    const progress = cond(
      eq(this.drawerWidth, 0),
      0,
      abs(divide(this.translateX, this.drawerWidth))
    );
    const translateX = right
      ? max(multiply(this.drawerWidth, -1), this.translateX)
      : min(this.drawerWidth, this.translateX);

    const offset = I18nManager.isRTL ? '100%' : multiply(this.drawerWidth, -1);

    return (
      <React.Fragment>
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents={open ? 'auto' : 'none'}
        >
          <TouchableWithoutFeedback
            onPress={locked ? undefined : this.handleBackdropPress}
          >
            <Animated.View
              style={[
                styles.backdrop,
                { opacity: progress },
                this.props.backdropStyle,
              ]}
            />
          </TouchableWithoutFeedback>
        </View>
        <PanGestureHandler
          onGestureEvent={this.handleGestureEvent}
          onHandlerStateChange={this.handleGestureEvent}
          hitSlop={
            right
              ? { left: swipeEdgeWidth, right: 0 }
              : { left: 0, right: swipeEdgeWidth }
          }
          enabled={!locked}
        >
          <Animated.View
            removeClippedSubviews={Platform.OS !== 'ios'}
            onLayout={this.handleLayout}
            style={[
              styles.container,
              right ? { right: offset } : { left: offset },
              { transform: [{ translateX }], opacity: this.drawerOpacity },
              this.props.contentContainerStyle as any,
            ]}
          >
            {this.props.renderContent({ progress })}
          </Animated.View>
        </PanGestureHandler>
      </React.Fragment>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '80%',
    maxWidth: '100%',
    elevation: 8,
    overflow: 'hidden',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});
